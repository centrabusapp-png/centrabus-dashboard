import AuthGate from './AuthGate';
import LoginPage from './auth/LoginPage';
import LoadablePanel from './LoadablePanel';

const loadDashboard = () => import('./App').then(({ AuthorizedDashboard }) => ({ default: AuthorizedDashboard }));

// The entrypoint stays small: Leaflet and dashboard code load only after a fresh
// administrator profile check. SDK session persistence remains unchanged.
export default function DashboardApp({ dashboardLoader = loadDashboard }) {
  return (
    <AuthGate renderLogin={({ signIn, resetPassword, ...loginProps }) => <LoginPage {...loginProps} onSignIn={signIn} onResetPassword={resetPassword} />}>
      {(user) => <LoadablePanel load={dashboardLoader} loadingLabel="Loading fleet dashboard…" user={user} />}
    </AuthGate>
  );
}
