import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import {
  authorizeNativeSession,
  recordNativeAdminLogin,
  sendNativePasswordReset,
  signInNativeAdmin,
  updateNativePassword,
} from './supabaseNativeAuth';

function nativeAuthenticationMessage(error) {
  if (error?.status === 429 || error?.code === 'over_request_rate_limit') {
    return 'Too many attempts. Try again later.';
  }
  if (error?.name === 'TypeError' || error?.status >= 500) {
    return 'Network or service error. Check your connection and try again.';
  }
  return 'Incorrect email or password, or this account is not available.';
}

function nativeAuthorizationMessage(reason) {
  if (reason === 'not-admin') return 'This account is not an authorized administrator.';
  if (reason === 'inactive') return 'This administrator account is inactive.';
  if (reason === 'profile-not-found') return 'No linked CentraBus administrator profile was found.';
  return 'Unable to verify administrator access. Please try again.';
}

export default function SupabaseNativeAuthGate({ renderLogin, children }) {
  const [status, setStatus] = useState('checking');
  const [user, setUser] = useState(null);
  const [authorizationError, setAuthorizationError] = useState('');
  const [authenticationError, setAuthenticationError] = useState('');
  const [passwordResetError, setPasswordResetError] = useState('');
  const [passwordResetSuccess, setPasswordResetSuccess] = useState('');
  const signInInProgress = useRef(false);
  const passwordRecoveryInProgress = useRef(false);
  const lastLoginUpdateUserId = useRef(null);
  const validationSequence = useRef(0);
  const verifiedUser = useRef(null);
  const retryTimer = useRef(null);
  const retryCount = useRef(0);
  const currentSessionUser = useRef(null);

  const validateSession = useCallback(async (sessionUser) => {
    clearTimeout(retryTimer.current);
    currentSessionUser.current = sessionUser;
    const currentSequence = ++validationSequence.current;
    if (verifiedUser.current?.id !== sessionUser?.id) {
      verifiedUser.current = null;
      setUser(null);
    }
    if (!sessionUser) {
      lastLoginUpdateUserId.current = null;
      setUser(null);
      setStatus('signed-out');
      return;
    }

    setStatus('checking');
    setAuthorizationError('');
    let result;
    try {
      result = await authorizeNativeSession(supabase, sessionUser);
    } catch {
      result = { ok: false, reason: 'profile-query-failed' };
    }
    if (currentSequence !== validationSequence.current) return;

    if (!result.ok) {
      if (result.reason === 'profile-query-failed') {
        // Keep this already-verified user's dashboard/cache mounted, but block
        // interaction until authorization is rechecked. Never grant new access.
        setAuthorizationError(nativeAuthorizationMessage(result.reason));
        setStatus('verification-paused');
        if (retryCount.current < 3) {
          const delay = [1000, 3000, 10000][retryCount.current++];
          retryTimer.current = setTimeout(() => void validateSession(sessionUser), delay);
        }
        return;
      }
      verifiedUser.current = null;
      setUser(null);
      setAuthorizationError(nativeAuthorizationMessage(result.reason));
      setStatus('signed-out');
      return;
    }

    if (lastLoginUpdateUserId.current !== sessionUser.id) {
      lastLoginUpdateUserId.current = sessionUser.id;
      void recordNativeAdminLogin(supabase);
    }

    if (currentSequence !== validationSequence.current) return;
    retryCount.current = 0;
    verifiedUser.current = sessionUser;
    setUser(sessionUser);
    setStatus('authorized');
  }, []);

  useEffect(() => {
    let mounted = true;
    const retryVerification = () => {
      if (!mounted || passwordRecoveryInProgress.current || !currentSessionUser.current) return;
      if (document.visibilityState === 'hidden') return;
      retryCount.current = 0;
      void validateSession(currentSessionUser.current);
    };
    window.addEventListener('online', retryVerification);
    document.addEventListener('visibilitychange', retryVerification);
    const { data: authSubscription } = supabase.auth.onAuthStateChange((event, session) => {
      // Sign-in is authorized in the submit handler; avoiding a duplicate
      // profile/RPC pass prevents two login timestamp writes for one session.
      if (event === 'SIGNED_IN' && signInInProgress.current) return;

      queueMicrotask(() => {
        if (!mounted) return;
        const recoveryRequested = window.location.hash.includes('type=recovery')
          || new URLSearchParams(window.location.search).get('type') === 'recovery';
        if ((event === 'PASSWORD_RECOVERY' || (event === 'INITIAL_SESSION' && recoveryRequested)) && session?.user) {
          passwordRecoveryInProgress.current = true;
          validationSequence.current += 1;
          setUser(session.user);
          setPasswordResetError('');
          setPasswordResetSuccess('');
          setStatus('password-recovery');
          return;
        }
        if (passwordRecoveryInProgress.current && event !== 'SIGNED_OUT') return;
        if (event === 'SIGNED_OUT') passwordRecoveryInProgress.current = false;
        retryCount.current = 0;
        void validateSession(session?.user || null);
      });
    });

    return () => {
      mounted = false;
      validationSequence.current += 1;
      clearTimeout(retryTimer.current);
      window.removeEventListener('online', retryVerification);
      document.removeEventListener('visibilitychange', retryVerification);
      authSubscription.subscription.unsubscribe();
    };
  }, [validateSession]);

  const signIn = async (email, password) => {
    setAuthenticationError('');
    setAuthorizationError('');
    setPasswordResetError('');
    setPasswordResetSuccess('');
    signInInProgress.current = true;
    try {
      const result = await signInNativeAdmin(supabase, email, password);
      if (!result.ok) {
        if (result.reason === 'authentication-failed') {
          setAuthenticationError(nativeAuthenticationMessage(result.error));
        } else {
          setAuthorizationError(nativeAuthorizationMessage(result.reason));
        }
        return false;
      }
      lastLoginUpdateUserId.current = result.user.id;
      verifiedUser.current = result.user;
      currentSessionUser.current = result.user;
      setUser(result.user);
      setStatus('authorized');
      return true;
    } catch (error) {
      setAuthenticationError(nativeAuthenticationMessage(error));
      return false;
    } finally {
      signInInProgress.current = false;
    }
  };

  const resetPassword = async (email) => {
    setAuthenticationError('');
    setAuthorizationError('');
    setPasswordResetError('');
    setPasswordResetSuccess('');
    const result = await sendNativePasswordReset(supabase, email, window.location.origin);
    if (!result.ok) {
      setPasswordResetError(result.reason === 'email-required'
        ? 'Enter a valid email address.'
        : 'Unable to send a password reset email. Please try again.');
      return false;
    }
    setPasswordResetSuccess('Password reset email sent. Check your inbox.');
    return true;
  };

  const saveNewPassword = async (password) => {
    setPasswordResetError('');
    setPasswordResetSuccess('');
    const result = await updateNativePassword(supabase, password);
    if (!result.ok) {
      setPasswordResetError(result.reason === 'password-too-short'
        ? 'Use a password with at least 8 characters.'
        : 'Unable to update the password. Please try again.');
      return false;
    }

    setPasswordResetSuccess('Password updated. Signing in securely…');
    passwordRecoveryInProgress.current = false;
    const sessionUser = result.user || user;
    const authorization = await authorizeNativeSession(supabase, sessionUser);
    if (!authorization.ok) {
      setUser(null);
      setAuthorizationError(nativeAuthorizationMessage(authorization.reason));
      setStatus('signed-out');
      return false;
    }
    lastLoginUpdateUserId.current = sessionUser.id;
    verifiedUser.current = sessionUser;
    currentSessionUser.current = sessionUser;
    setUser(sessionUser);
    setStatus('authorized');
    return true;
  };

  const cancelPasswordRecovery = async () => {
    passwordRecoveryInProgress.current = false;
    await supabase.auth.signOut();
    setUser(null);
    setStatus('signed-out');
    setPasswordResetSuccess('Password reset cancelled. You can sign in below.');
  };

  if (verifiedUser.current && user && ['authorized', 'checking', 'verification-paused'].includes(status)) {
    const blocked = status !== 'authorized';
    return (
      <div className="relative" data-testid="verified-dashboard-shell">
        <div data-testid="protected-dashboard-content" inert={blocked} aria-hidden={blocked ? true : undefined}>
          {children(user)}
        </div>
        {blocked && <div className="fixed inset-0 z-[9999] grid place-items-center bg-slate-900 p-6 text-center text-white" role="alert">
          <div>
            <p className="font-bold">{status === 'checking' ? 'Checking secure access…' : 'Connection interrupted. Administrator access must be reverified.'}</p>
            {status === 'verification-paused' && <button className="mt-4 rounded-lg bg-white px-4 py-2 font-bold text-slate-900" onClick={() => { retryCount.current = 0; void validateSession(currentSessionUser.current); }}>Retry secure connection</button>}
          </div>
        </div>}
      </div>
    );
  }

  if (status === 'checking' || status === 'verification-paused') {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F7F8FA] text-center text-slate-700">
        <div>
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[#E9C3C8] border-t-[#8E1F2F]" />
          <p className="mt-4 text-sm font-bold">{status === 'checking' ? 'Checking secure access…' : 'Unable to verify access. Check your connection.'}</p>
          {status === 'verification-paused' && <button onClick={() => { retryCount.current = 0; void validateSession(currentSessionUser.current); }}>Retry secure connection</button>}
        </div>
      </main>
    );
  }

  if (status === 'password-recovery') {
    return renderLogin({
      authenticationError,
      authorizationError,
      passwordResetError,
      passwordResetSuccess,
      signIn,
      resetPassword,
      passwordRecovery: true,
      onUpdatePassword: saveNewPassword,
      onCancelPasswordRecovery: cancelPasswordRecovery,
    });
  }

  if (status !== 'authorized' || !user) {
    return renderLogin({
      authenticationError,
      authorizationError,
      passwordResetError,
      passwordResetSuccess,
      signIn,
      resetPassword,
    });
  }

  return children(user);
}
