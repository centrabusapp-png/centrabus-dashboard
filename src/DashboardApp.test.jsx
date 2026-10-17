import { act, render, screen } from '@testing-library/react';
import DashboardApp from './DashboardApp';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({
  supabase: {
    auth: { onAuthStateChange: jest.fn(), signOut: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

let authChanged;
let query;
beforeEach(() => {
  jest.clearAllMocks();
  query = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    maybeSingle: jest.fn().mockResolvedValue({ data: { role: 'admin', is_active: true }, error: null }),
  };
  supabase.from.mockReturnValue(query);
  supabase.rpc.mockResolvedValue({ error: null });
  supabase.auth.signOut.mockResolvedValue({ error: null });
  supabase.auth.onAuthStateChange.mockImplementation((callback) => {
    authChanged = callback;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
});

test('login and password recovery do not download the map/dashboard chunk', async () => {
  const dashboardLoader = jest.fn();
  render(<DashboardApp dashboardLoader={dashboardLoader} />);
  await act(async () => authChanged('INITIAL_SESSION', null));
  expect(screen.getByRole('heading', { name: 'Admin Login' })).toBeInTheDocument();
  expect(dashboardLoader).not.toHaveBeenCalled();
  await act(async () => authChanged('PASSWORD_RECOVERY', { user: { id: 'test-user' } }));
  expect(screen.getByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
  expect(dashboardLoader).not.toHaveBeenCalled();
  expect(supabase.from).not.toHaveBeenCalled();
});

test('dashboard download starts only after a fresh active-admin profile check', async () => {
  let finishProfile;
  let finishDashboard;
  query.maybeSingle.mockImplementation(() => new Promise((resolve) => { finishProfile = resolve; }));
  const dashboardLoader = jest.fn(() => new Promise((resolve) => { finishDashboard = resolve; }));
  render(<DashboardApp dashboardLoader={dashboardLoader} />);
  await act(async () => authChanged('INITIAL_SESSION', { user: { id: 'test-user' } }));
  expect(dashboardLoader).not.toHaveBeenCalled();
  await act(async () => finishProfile({ data: { role: 'admin', is_active: true }, error: null }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading fleet dashboard');
  expect(dashboardLoader).toHaveBeenCalledTimes(1);
  await act(async () => finishDashboard({ default: ({ user }) => <div>Verified {user.email || 'administrator'}</div> }));
  expect(await screen.findByText('Verified administrator')).toBeInTheDocument();
  expect(query.eq).toHaveBeenCalledWith('auth_user_id', 'test-user');
});

test.each([
  { role: 'admin', is_active: false },
  { role: 'dispatcher', is_active: true },
])('denied profiles cannot load private dashboard code (%o)', async (profile) => {
  query.maybeSingle.mockResolvedValue({ data: profile, error: null });
  const dashboardLoader = jest.fn();
  render(<DashboardApp dashboardLoader={dashboardLoader} />);
  await act(async () => authChanged('INITIAL_SESSION', { user: { id: 'test-user' } }));
  expect(screen.getByRole('heading', { name: 'Admin Login' })).toBeInTheDocument();
  expect(dashboardLoader).not.toHaveBeenCalled();
  expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
});

test('session refresh reuses downloaded view without bypassing profile authorization', async () => {
  const dashboardLoader = jest.fn().mockResolvedValue({ default: () => <div>Verified fleet</div> });
  render(<DashboardApp dashboardLoader={dashboardLoader} />);
  await act(async () => authChanged('INITIAL_SESSION', { user: { id: 'test-user' } }));
  expect(await screen.findByText('Verified fleet')).toBeInTheDocument();
  await act(async () => authChanged('TOKEN_REFRESHED', { user: { id: 'test-user' } }));
  expect(await screen.findByText('Verified fleet')).toBeInTheDocument();
  expect(dashboardLoader).toHaveBeenCalledTimes(1);
  expect(query.maybeSingle).toHaveBeenCalledTimes(2);
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
});

test('sign-out during a dashboard download prevents late private rendering', async () => {
  let finish;
  const View = jest.fn(() => <div>Private fleet</div>);
  const dashboardLoader = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  render(<DashboardApp dashboardLoader={dashboardLoader} />);
  await act(async () => authChanged('INITIAL_SESSION', { user: { id: 'test-user' } }));
  await act(async () => authChanged('SIGNED_OUT', null));
  await act(async () => finish({ default: View }));
  expect(screen.getByRole('heading', { name: 'Admin Login' })).toBeInTheDocument();
  expect(View).not.toHaveBeenCalled();
});
