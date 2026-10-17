import {
  authorizeNativeSession,
  findNativeAdminProfile,
  recordNativeAdminLogin,
  sendNativePasswordReset,
  signInNativeAdmin,
  signOutNativeUser,
  updateNativePassword,
} from './supabaseNativeAuth';

const makeClient = ({ profile, profileError, loginError, authError } = {}) => {
  const maybeSingle = jest.fn().mockResolvedValue({ data: profile, error: profileError });
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  return {
    from: jest.fn(() => ({ select })),
    auth: {
      signInWithPassword: jest.fn().mockResolvedValue({
        data: { user: { id: 'native-user-id' } },
        error: authError,
      }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
      updateUser: jest.fn().mockResolvedValue({ data: { user: { id: 'native-user-id' } }, error: null }),
    },
    rpc: jest.fn().mockResolvedValue({ error: loginError }),
    query: { select, eq, maybeSingle },
  };
};

test('dashboard logout calls only native Supabase Auth', async () => {
  const client = makeClient();

  await expect(signOutNativeUser(client)).resolves.toEqual({ error: null });
  expect(client.auth.signOut).toHaveBeenCalledTimes(1);
  expect(client.from).not.toHaveBeenCalled();
  expect(client.rpc).not.toHaveBeenCalled();
});

test('native logout preserves a returned Auth error instead of reporting success', async () => {
  const client = makeClient();
  const error = { code: 'auth-service-unavailable' };
  client.auth.signOut.mockResolvedValue({ error });

  await expect(signOutNativeUser(client)).resolves.toEqual({ error });
  expect(client.auth.signOut).toHaveBeenCalledTimes(1);
});

test('native logout propagates a network rejection without a fallback provider', async () => {
  const client = makeClient();
  const error = new Error('Network unavailable');
  client.auth.signOut.mockRejectedValue(error);

  await expect(signOutNativeUser(client)).rejects.toBe(error);
  expect(client.auth.signOut).toHaveBeenCalledTimes(1);
});

test('finds an active admin by native auth_user_id', async () => {
  const profile = {
    id: 1,
    auth_user_id: 'native-user-id',
    role: 'admin',
    is_active: true,
  };
  const client = makeClient({ profile });

  await expect(findNativeAdminProfile(client, 'native-user-id'))
    .resolves.toEqual({ ok: true, profile });
  expect(client.from).toHaveBeenCalledWith('profiles');
  expect(client.query.select).toHaveBeenCalledWith('id, auth_user_id, role, is_active');
  expect(client.query.eq).toHaveBeenCalledWith('auth_user_id', 'native-user-id');
});

test('a profile read outage blocks access without destroying the native session', async () => {
  const client = makeClient({ profileError: { code: 'network-unavailable' } });
  await expect(authorizeNativeSession(client, { id: 'native-user-id' })).resolves.toMatchObject({ ok: false, reason: 'profile-query-failed' });
  expect(client.auth.signOut).not.toHaveBeenCalled();
});

test('rejects missing native identity and profile', async () => {
  const client = makeClient();

  await expect(findNativeAdminProfile(client, null))
    .resolves.toMatchObject({ ok: false, reason: 'unauthenticated' });
  await expect(findNativeAdminProfile(client, 'missing-user'))
    .resolves.toMatchObject({ ok: false, reason: 'profile-not-found' });
  expect(client.from).toHaveBeenCalledTimes(1);
});

test('rejects non-admin and inactive profiles', async () => {
  const nonAdmin = makeClient({ profile: { role: 'dispatcher', is_active: true } });
  const inactiveAdmin = makeClient({ profile: { role: 'admin', is_active: false } });

  await expect(findNativeAdminProfile(nonAdmin, 'user-1'))
    .resolves.toMatchObject({ ok: false, reason: 'not-admin' });
  await expect(findNativeAdminProfile(inactiveAdmin, 'user-2'))
    .resolves.toMatchObject({ ok: false, reason: 'inactive' });
});

test('sign-in trims email and profile denial signs out the native session', async () => {
  const client = makeClient({ profile: { role: 'user', is_active: true } });

  await expect(signInNativeAdmin(client, ' admin@example.com ', 'private-password'))
    .resolves.toMatchObject({ ok: false, reason: 'not-admin' });
  expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
    email: 'admin@example.com',
    password: 'private-password',
  });
  expect(client.auth.signOut).toHaveBeenCalledTimes(1);
});

test('authorized sign-in remains successful when last-login metadata fails', async () => {
  const profile = { id: 1, role: 'admin', is_active: true };
  const client = makeClient({ profile, loginError: { code: 'rpc-unavailable' } });

  const result = await signInNativeAdmin(client, 'admin@example.com', 'private-password');
  expect(result).toMatchObject({ ok: true, profile });
  await expect(result.lastLoginUpdate).resolves.toBe(false);
  expect(client.rpc).toHaveBeenCalledWith('touch_current_admin_profile_login');
  expect(client.auth.signOut).not.toHaveBeenCalled();
});

test('authorized sign-in resolves while login metadata is still pending', async () => {
  const client = makeClient({ profile: { id: 1, role: 'admin', is_active: true } });
  let finishMetadata;
  client.rpc.mockImplementation(() => new Promise((resolve) => { finishMetadata = resolve; }));
  const result = await signInNativeAdmin(client, 'admin@example.com', 'private-password');
  expect(result.ok).toBe(true);
  expect(client.rpc).toHaveBeenCalledTimes(1);
  finishMetadata({ error: null });
  await expect(result.lastLoginUpdate).resolves.toBe(true);
});

test('background login metadata failure is handled without an unhandled rejection', async () => {
  const client = makeClient();
  client.rpc.mockRejectedValue(new Error('Service unavailable'));
  await expect(recordNativeAdminLogin(client)).resolves.toBe(false);
});

test('background login metadata request is bounded by an abort timeout', async () => {
  jest.useFakeTimers();
  try {
    const client = makeClient();
    let signal;
    client.rpc.mockReturnValue({ abortSignal: (value) => {
      signal = value;
      return new Promise((resolve) => value.addEventListener('abort', () => resolve({ error: { message: 'Aborted' } })));
    } });
    const update = recordNativeAdminLogin(client);
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(5000);
    await expect(update).resolves.toBe(false);
    expect(signal.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test('password reset uses the native Supabase Auth API with a trimmed email', async () => {
  const client = makeClient();

  await expect(sendNativePasswordReset(client, ' admin@example.com ', 'https://app.example/reset'))
    .resolves.toEqual({ ok: true });
  expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith(
    'admin@example.com',
    { redirectTo: 'https://app.example/reset' },
  );
});

test('native password update requires a minimum length and calls Supabase Auth', async () => {
  const client = makeClient();

  await expect(updateNativePassword(client, 'short'))
    .resolves.toMatchObject({ ok: false, reason: 'password-too-short' });
  expect(client.auth.updateUser).not.toHaveBeenCalled();

  await expect(updateNativePassword(client, 'long-enough-password'))
    .resolves.toMatchObject({ ok: true, user: { id: 'native-user-id' } });
  expect(client.auth.updateUser).toHaveBeenCalledWith({ password: 'long-enough-password' });
});
