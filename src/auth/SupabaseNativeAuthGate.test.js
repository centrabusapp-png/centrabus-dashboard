import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthGate from '../AuthGate';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
    },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

let authStateCallback;

test('same-user revalidation/outage preserves dashboard cache but blocks access until retry succeeds', async () => {
  let mounts = 0;
  let unmounts = 0;
  function CachedDashboard() {
    useEffect(() => { mounts += 1; return () => { unmounts += 1; }; }, []);
    return <button>Cached fleet</button>;
  }
  const user = { id: 'native-auth-id' };
  const { unmount } = render(<AuthGate renderLogin={() => <div>Login</div>}>{() => <CachedDashboard />}</AuthGate>);
  await act(async () => authStateCallback('INITIAL_SESSION', { user }));
  await screen.findByText('Cached fleet');
  const query = supabase.from.mock.results[0].value;
  query.maybeSingle.mockResolvedValue({ data: null, error: { code: 'network-unavailable' } });
  await act(async () => authStateCallback('TOKEN_REFRESHED', { user }));
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
  expect(screen.getByTestId('protected-dashboard-content')).toHaveAttribute('inert');
  expect(screen.queryByRole('button', { name: 'Cached fleet' })).not.toBeInTheDocument();
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
  query.maybeSingle.mockResolvedValue({ data: { role: 'admin', is_active: true }, error: null });
  fireEvent.click(screen.getByRole('button', { name: 'Retry secure connection' }));
  await screen.findByRole('button', { name: 'Cached fleet' });
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
  unmount();
  expect(unmounts).toBe(1);
});

test('a different user cannot inherit the verified dashboard during a network failure', async () => {
  render(<AuthGate renderLogin={() => <div>Login</div>}>{() => <div>Cached fleet</div>}</AuthGate>);
  await act(async () => authStateCallback('INITIAL_SESSION', { user: { id: 'first-user' } }));
  await screen.findByText('Cached fleet');
  supabase.from.mock.results[0].value.maybeSingle.mockResolvedValue({ data: null, error: { code: 'network-unavailable' } });
  await act(async () => authStateCallback('SIGNED_IN', { user: { id: 'different-user' } }));
  expect(screen.queryByText('Cached fleet')).not.toBeInTheDocument();
  expect(screen.getByText('Unable to verify access. Check your connection.')).toBeInTheDocument();
});

beforeEach(() => {
  jest.clearAllMocks();
  authStateCallback = null;
  supabase.auth.onAuthStateChange.mockImplementation((callback) => {
    authStateCallback = callback;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  supabase.auth.signOut.mockResolvedValue({ error: null });
  supabase.rpc.mockResolvedValue({ error: null });

  const query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    maybeSingle: jest.fn().mockResolvedValue({
      data: { id: 1, auth_user_id: 'native-auth-id', role: 'admin', is_active: true },
      error: null,
    }),
  };
  supabase.from.mockReturnValue(query);
});

function LoginRenderer({ signIn }) {
  return <button type="button" onClick={() => signIn('admin@example.com', 'not-a-real-password')}>Test native sign-in</button>;
}

test('public AuthGate authorizes only a native Supabase session against auth_user_id', async () => {
  const user = { id: 'native-auth-id', email: 'admin@example.com' };
  supabase.auth.signInWithPassword.mockResolvedValue({ data: { user }, error: null });

  render(
    <AuthGate
      renderLogin={(props) => <LoginRenderer {...props} />}
    >
      {(authorizedUser) => <div>Native dashboard for {authorizedUser.email}</div>}
    </AuthGate>,
  );

  await waitFor(() => expect(authStateCallback).toEqual(expect.any(Function)));
  act(() => authStateCallback('INITIAL_SESSION', { user: null }));
  fireEvent.click(await screen.findByRole('button', { name: 'Test native sign-in' }));

  expect(await screen.findByText('Native dashboard for admin@example.com')).toBeInTheDocument();
  expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
    email: 'admin@example.com',
    password: 'not-a-real-password',
  });
  expect(supabase.from).toHaveBeenCalledWith('profiles');
  expect(supabase.rpc).toHaveBeenCalledWith('touch_current_admin_profile_login');
});

test('native AuthGate exposes password recovery only for a recovery callback', async () => {
  let recoveryProps;
  render(
    <AuthGate
      renderLogin={(props) => {
        recoveryProps = props;
        return <div>{props.passwordRecovery ? 'Native password recovery' : 'Native sign-in'}</div>;
      }}
    >
      <div>Native dashboard</div>
    </AuthGate>,
  );

  await waitFor(() => expect(authStateCallback).toEqual(expect.any(Function)));
  act(() => authStateCallback('PASSWORD_RECOVERY', {
    user: { id: 'native-auth-id', email: 'admin@example.com' },
  }));

  expect(await screen.findByText('Native password recovery')).toBeInTheDocument();
  expect(recoveryProps.onUpdatePassword).toEqual(expect.any(Function));
  expect(recoveryProps.onCancelPasswordRecovery).toEqual(expect.any(Function));
});

test('restores an existing native session only after the linked admin profile is verified', async () => {
  render(
    <AuthGate renderLogin={() => <div>Native sign-in</div>}>
      {(user) => <div>Restored dashboard for {user.email}</div>}
    </AuthGate>,
  );

  await waitFor(() => expect(authStateCallback).toEqual(expect.any(Function)));
  act(() => authStateCallback('INITIAL_SESSION', {
    user: { id: 'native-auth-id', email: 'admin@example.com' },
  }));

  expect(await screen.findByText('Restored dashboard for admin@example.com')).toBeInTheDocument();
  expect(supabase.from).toHaveBeenCalledWith('profiles');
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
});

test('restored dashboard does not wait for slow login metadata and never skips the profile check', async () => {
  let finishProfile;
  let finishMetadata;
  const query = supabase.from();
  query.maybeSingle.mockImplementation(() => new Promise((resolve) => { finishProfile = resolve; }));
  supabase.rpc.mockImplementation(() => new Promise((resolve) => { finishMetadata = resolve; }));
  render(<AuthGate renderLogin={() => <div>Native sign-in</div>}>{() => <div>Private dashboard</div>}</AuthGate>);
  await act(async () => authStateCallback('INITIAL_SESSION', { user: { id: 'native-auth-id' } }));
  expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument();
  expect(supabase.rpc).not.toHaveBeenCalled();
  await act(async () => finishProfile({ data: { role: 'admin', is_active: true }, error: null }));
  expect(await screen.findByText('Private dashboard')).toBeInTheDocument();
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  await act(async () => finishMetadata({ error: null }));
  expect(screen.getByText('Private dashboard')).toBeInTheDocument();
});

test('denies and signs out a restored session without an active admin profile', async () => {
  const query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    maybeSingle: jest.fn().mockResolvedValue({
      data: { id: 1, auth_user_id: 'native-auth-id', role: 'admin', is_active: false },
      error: null,
    }),
  };
  supabase.from.mockReturnValue(query);

  render(
    <AuthGate
      renderLogin={({ authorizationError }) => <div>{authorizationError || 'Native sign-in'}</div>}
    >
      <div>Private dashboard</div>
    </AuthGate>,
  );
  await waitFor(() => expect(authStateCallback).toEqual(expect.any(Function)));
  act(() => authStateCallback('INITIAL_SESSION', {
    user: { id: 'native-auth-id', email: 'admin@example.com' },
  }));

  expect(await screen.findByText('This administrator account is inactive.')).toBeInTheDocument();
  expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument();
  expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
});

test('a native sign-out event clears restored dashboard access', async () => {
  render(
    <AuthGate renderLogin={() => <div>Native sign-in</div>}>
      {() => <div>Private dashboard</div>}
    </AuthGate>,
  );
  await waitFor(() => expect(authStateCallback).toEqual(expect.any(Function)));
  act(() => authStateCallback('INITIAL_SESSION', {
    user: { id: 'native-auth-id', email: 'admin@example.com' },
  }));
  expect(await screen.findByText('Private dashboard')).toBeInTheDocument();

  act(() => authStateCallback('SIGNED_OUT', null));
  expect(await screen.findByText('Native sign-in')).toBeInTheDocument();
  expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument();
});

test('a refreshed native session rechecks the profile without duplicating login metadata', async () => {
  const user = { id: 'native-auth-id', email: 'admin@example.com' };
  render(
    <AuthGate renderLogin={() => <div>Native sign-in</div>}>
      {() => <div>Private dashboard</div>}
    </AuthGate>,
  );
  await waitFor(() => expect(authStateCallback).toEqual(expect.any(Function)));
  act(() => authStateCallback('INITIAL_SESSION', { user }));
  expect(await screen.findByText('Private dashboard')).toBeInTheDocument();

  await act(async () => authStateCallback('TOKEN_REFRESHED', { user }));

  expect(await screen.findByText('Private dashboard')).toBeInTheDocument();
  expect(supabase.from).toHaveBeenCalledTimes(2);
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.auth.signOut).not.toHaveBeenCalled();
});

test('a refreshed native session loses dashboard access when the admin profile is disabled', async () => {
  const user = { id: 'native-auth-id', email: 'admin@example.com' };
  render(
    <AuthGate
      renderLogin={({ authorizationError }) => <div>{authorizationError || 'Native sign-in'}</div>}
    >
      {() => <div>Private dashboard</div>}
    </AuthGate>,
  );
  await waitFor(() => expect(authStateCallback).toEqual(expect.any(Function)));
  act(() => authStateCallback('INITIAL_SESSION', { user }));
  expect(await screen.findByText('Private dashboard')).toBeInTheDocument();
  const query = supabase.from.mock.results[0].value;
  query.maybeSingle.mockResolvedValue({
    data: { id: 1, auth_user_id: 'native-auth-id', role: 'admin', is_active: false },
    error: null,
  });

  await act(async () => authStateCallback('TOKEN_REFRESHED', { user }));

  expect(await screen.findByText('This administrator account is inactive.')).toBeInTheDocument();
  expect(screen.queryByText('Private dashboard')).not.toBeInTheDocument();
  expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
});

test('native password recovery updates the password and rechecks admin authorization', async () => {
  let recoveryProps;
  supabase.auth.updateUser.mockResolvedValue({
    data: { user: { id: 'native-auth-id', email: 'admin@example.com' } },
    error: null,
  });
  render(
    <AuthGate
      renderLogin={(props) => {
        recoveryProps = props;
        return <div>{props.passwordRecovery ? 'Native password recovery' : 'Native sign-in'}</div>;
      }}
    >
      {() => <div>Private dashboard</div>}
    </AuthGate>,
  );
  await waitFor(() => expect(authStateCallback).toEqual(expect.any(Function)));
  act(() => authStateCallback('PASSWORD_RECOVERY', {
    user: { id: 'native-auth-id', email: 'admin@example.com' },
  }));
  expect(await screen.findByText('Native password recovery')).toBeInTheDocument();

  await act(async () => {
    expect(await recoveryProps.onUpdatePassword('safe-test-password')).toBe(true);
  });
  expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'safe-test-password' });
  expect(supabase.from).toHaveBeenCalledWith('profiles');
  expect(await screen.findByText('Private dashboard')).toBeInTheDocument();
});
