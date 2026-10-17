export async function signOutNativeUser(supabaseClient) {
  return supabaseClient.auth.signOut();
}

export async function findNativeAdminProfile(supabaseClient, authUserId) {
  if (!authUserId) {
    return { ok: false, reason: 'unauthenticated' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let response;
  try {
    const query = supabaseClient
    .from('profiles')
    .select('id, auth_user_id, role, is_active')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
    response = await (query.abortSignal ? query.abortSignal(controller.signal) : query);
  } catch (error) {
    return { ok: false, reason: 'profile-query-failed', error };
  } finally {
    clearTimeout(timeout);
  }
  const { data: profile, error } = response;

  if (error) {
    return { ok: false, reason: 'profile-query-failed', error };
  }
  if (!profile) {
    return { ok: false, reason: 'profile-not-found' };
  }
  if (profile.role !== 'admin') {
    return { ok: false, reason: 'not-admin', profile };
  }
  if (profile.is_active !== true) {
    return { ok: false, reason: 'inactive', profile };
  }

  return { ok: true, profile };
}

export async function authorizeNativeSession(supabaseClient, user) {
  const result = await findNativeAdminProfile(supabaseClient, user?.id);
  if (!result.ok && result.reason !== 'profile-query-failed') {
    try {
      await supabaseClient.auth.signOut();
    } catch {
      // The caller still blocks dashboard access if sign-out cannot reach Auth.
    }
  }
  return result;
}

// Best-effort metadata is not an authorization condition. The caller may inspect
// the result, but dashboard startup must not wait for this separate request.
export async function recordNativeAdminLogin(supabaseClient) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const request = supabaseClient.rpc('touch_current_admin_profile_login');
    const { error } = await (request.abortSignal ? request.abortSignal(controller.signal) : request);
    return !error;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function signInNativeAdmin(supabaseClient, email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: typeof email === 'string' ? email.trim() : '',
    password,
  });

  if (error) {
    return { ok: false, reason: 'authentication-failed', error };
  }

  const user = data?.user;
  const authorization = await authorizeNativeSession(supabaseClient, user);
  if (!authorization.ok) {
    return authorization;
  }

  const lastLoginUpdate = recordNativeAdminLogin(supabaseClient);
  return { ok: true, user, profile: authorization.profile, lastLoginUpdate };
}

export async function sendNativePasswordReset(supabaseClient, email, redirectTo) {
  if (typeof email !== 'string' || !email.trim()) {
    return { ok: false, reason: 'email-required' };
  }

  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(
      email.trim(),
      redirectTo ? { redirectTo } : undefined,
    );
    return error
      ? { ok: false, reason: 'password-reset-failed', error }
      : { ok: true };
  } catch (error) {
    return { ok: false, reason: 'password-reset-failed', error };
  }
}

export async function updateNativePassword(supabaseClient, password) {
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, reason: 'password-too-short' };
  }

  try {
    const { data, error } = await supabaseClient.auth.updateUser({ password });
    return error
      ? { ok: false, reason: 'password-update-failed', error }
      : { ok: true, user: data?.user || null };
  } catch (error) {
    return { ok: false, reason: 'password-update-failed', error };
  }
}
