import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RemoteWifiPanel from './RemoteWifiPanel';
const state = (deviceId = 'GPS-002', changes = {}) => ({ deviceId, online: true, remainingMs: 15000, scanRemainingMs: 60000, profilesRemainingMs: 60000, trialRemainingMs: 30000, pendingCommandId: null,
  report: { sessionId: 'session-test', sequence: 1, connectEnabled: true, wifiConnected: true, internet: 'full', task: 'idle', trialId: 'trial-test',
    savedProfiles: [], profilesStatus: 'ready', networks: [{ id: 'network-test', ssid: 'Synthetic Hotspot', security: 'wpa2-personal', connected: false, signal: 75 }], ...changes } });
const fixture = (value = state()) => ({ enabled: true, read: jest.fn(async () => value), command: jest.fn(async () => ({ ok: true })) });
test('no authenticated agent means Unknown, not connected or a fake scan', async () => {
  const service = fixture({ deviceId: 'GPS-002', online: false });
  render(<RemoteWifiPanel authorized deviceId="GPS-002" service={service} />);
  await waitFor(() => expect(service.read).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'Scan Pi networks' })).toBeDisabled();
  expect(screen.getByText(/Unknown \/ agent unavailable/)).toBeInTheDocument(); expect(service.command).not.toHaveBeenCalled();
});
test('Scan queues a selected-device request, not a laptop scan or automatic connection', async () => {
  const service = fixture(); render(<RemoteWifiPanel authorized deviceId="GPS-002" service={service} />);
  await screen.findByText('GPS-002 agent reporting'); fireEvent.click(screen.getByRole('button', { name: 'Scan Pi networks' }));
  await waitFor(() => expect(service.command).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'GPS-002' }), 'scan', {}, expect.anything()));
  expect(screen.getByText(/not yet applied/)).toBeInTheDocument();
});
test('select, password and confirmation are required; password field clears on submission', async () => {
  const service = fixture(); render(<RemoteWifiPanel authorized deviceId="GPS-002" service={service} />);
  await screen.findByText('GPS-002 agent reporting'); fireEvent.click(screen.getByRole('button', { name: /Synthetic Hotspot/ }));
  expect(screen.getByRole('button', { name: 'Connect on Pi' })).toBeDisabled();
  const password = screen.getByLabelText('Wi-Fi password'); fireEvent.change(password, { target: { value: 'synthetic-password' } });
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.submit(password.closest('form'));
  await waitFor(() => expect(service.command).toHaveBeenCalledWith(expect.anything(), 'connect', expect.objectContaining({ password: 'synthetic-password' }), expect.anything()));
  expect(password.value).toBe('');
});
test('Keep and Rollback reference the exact reported trial', async () => {
  const service = fixture(state('GPS-002', { task: 'awaiting_confirmation' }));
  render(<RemoteWifiPanel authorized deviceId="GPS-002" service={service} />);
  await screen.findByRole('button', { name: 'Keep connection' }); fireEvent.click(screen.getByRole('button', { name: 'Keep connection' }));
  await waitFor(() => expect(service.command).toHaveBeenCalledWith(expect.anything(), 'keep', { trialId: 'trial-test' }, expect.anything()));
});
test('device switching clears old scan/password and aborted work cannot update new device', async () => {
  const service = fixture(); const view = render(<RemoteWifiPanel authorized deviceId="GPS-002" service={service} />);
  await screen.findByText('GPS-002 agent reporting'); fireEvent.click(screen.getByRole('button', { name: /Synthetic Hotspot/ }));
  const password = screen.getByLabelText('Wi-Fi password'); fireEvent.change(password, { target: { value: 'synthetic-password' } });
  service.read.mockResolvedValue({ deviceId: 'GPS-001', online: false });
  view.rerender(<RemoteWifiPanel authorized deviceId="GPS-001" service={service} />);
  await waitFor(() => expect(service.read).toHaveBeenCalledWith('GPS-001', expect.anything()));
  expect(password.value).toBe(''); expect(screen.queryByRole('button', { name: /Synthetic Hotspot/ })).not.toBeInTheDocument();
});
test('active-admin gating and stale failures never issue device commands', async () => {
  const service = fixture(); const view = render(<RemoteWifiPanel authorized={false} deviceId="GPS-002" service={service} />);
  expect(service.read).not.toHaveBeenCalled(); expect(view.container.textContent).toBe('');
  view.rerender(<RemoteWifiPanel authorized deviceId="GPS-002" service={service} />);
  await screen.findByText('GPS-002 agent reporting'); service.read.mockRejectedValue(new Error('fixture'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await screen.findByText(/Unknown \/ agent unavailable/);
  expect(screen.getByRole('button', { name: 'Scan Pi networks' })).toBeDisabled(); expect(service.command).not.toHaveBeenCalled();
});

const profile = { profileId: '22222222-2222-4222-8222-222222222222', profileVersion: 'a'.repeat(64), ssid: 'Synthetic Saved Depot',
  priority: 50, available: true, signal: 85, connected: false, security: 'wpa2-personal' };
test('saved profile requires confirmation but no repeated password, and sends the exact version', async () => {
  const service = fixture(state('GPS-002', { savedProfiles: [profile] }));
  render(<RemoteWifiPanel authorized deviceId="GPS-002" service={service} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Saved Synthetic Saved Depot' }));
  expect(screen.queryByLabelText('Wi-Fi password')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Connect on Pi' }));
  await waitFor(() => expect(service.command).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'GPS-002' }), 'connect_saved',
    { profileId: profile.profileId, profileVersion: profile.profileVersion }, expect.anything()));
});
test('unavailable saved network cannot connect; stale inventory cannot authorize a switch', async () => {
  const service = fixture(state('GPS-002', { savedProfiles: [{ ...profile, available: false, signal: null }] }));
  const view = render(<RemoteWifiPanel authorized deviceId="GPS-002" service={service} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Saved Synthetic Saved Depot' })); fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: 'Connect on Pi' })).toBeDisabled();
  service.read.mockResolvedValue({ ...state('GPS-002', { savedProfiles: [profile] }), profilesRemainingMs: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Saved Synthetic Saved Depot' })).toBeDisabled());
  expect(service.command).not.toHaveBeenCalled(); view.unmount();
});

test('duplicate saved SSIDs never silently pick a profile from the nearby list', async () => {
  const a = { ...profile, ssid: 'Synthetic Hotspot' }, b = { ...profile, ssid: 'Synthetic Hotspot', profileId: '33333333-3333-4333-8333-333333333333' };
  const service = fixture(state('GPS-002', { savedProfiles: [a, b] }));
  render(<RemoteWifiPanel authorized deviceId="GPS-002" service={service} />);
  await screen.findByText('GPS-002 agent reporting');
  fireEvent.click(screen.getByRole('button', { name: /^Synthetic Hotspot/ }));
  expect(screen.getByText(/More than one saved profile/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Connect on Pi' })).toBeDisabled(); expect(service.command).not.toHaveBeenCalled();
});

test('queued request is replaced by the matching authenticated completion, not HTTP acceptance', async () => {
  const service = fixture();
  service.command.mockImplementation(async () => {
    service.read.mockResolvedValue(state('GPS-002', { lastResult: { commandId: 'scan-command', outcome: 'applied' } }));
    return { ok: true, commandId: 'scan-command' };
  });
  render(<RemoteWifiPanel authorized deviceId="GPS-002" service={service} />);
  await screen.findByText('GPS-002 agent reporting'); fireEvent.click(screen.getByRole('button', { name: 'Scan Pi networks' }));
  await screen.findByText(/Pi scan completed/);
  expect(screen.queryByText(/Request queued/)).not.toBeInTheDocument();
});
