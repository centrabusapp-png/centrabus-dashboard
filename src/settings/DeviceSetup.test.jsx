import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DeviceSetup from './DeviceSetup';
import { pendingWifiState } from './wifiManagementModel';
const { TextEncoder } = require('util');
global.TextEncoder = TextEncoder;
const config = { configured: true, origin: 'http://localhost:5000', healthUrl: 'http://localhost:5000/health' };
const choose = (name) => fireEvent.click(screen.getByRole('tab', { name }));

test('graphical device selection uses Pi2 laptop Wi-Fi controls without pretending an agent is installed', async () => {
  const wifiService = { getState: jest.fn(async (deviceId) => pendingWifiState(deviceId)) };
  render(<DeviceSetup authorized wifiService={wifiService} />);
  expect(screen.getByRole('heading', { name: 'Device Setup' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Configure Pi1 GPS-001' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Scan networks' })).toBeDisabled();
  expect(screen.queryByLabelText('GPS device')).not.toBeInTheDocument();
  await waitFor(() => expect(wifiService.getState).toHaveBeenCalledWith('GPS-001', expect.any(Object)));
  fireEvent.click(screen.getByRole('button', { name: 'Configure Pi2 GPS-002' }));
  expect(wifiService.getState).not.toHaveBeenCalledWith('GPS-002', expect.any(Object));
  expect(screen.getByRole('button', { name: 'Configure Pi2 GPS-002' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('region', { name: 'Pi2 laptop Wi-Fi settings' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Wi-Fi settings' })).toBeInTheDocument();
  expect(screen.getByText('05 - Pi2 Wi-Fi Settings.cmd')).toBeInTheDocument();
  expect(screen.queryByText('GPS-002 setup connection')).not.toBeInTheDocument();
});

test('no admin means no status request, backend check or device controls', () => {
  const wifiService = { getState: jest.fn() }, checkBackend = jest.fn();
  render(<DeviceSetup wifiService={wifiService} checkBackend={checkBackend} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(wifiService.getState).not.toHaveBeenCalled(); expect(checkBackend).not.toHaveBeenCalled();
});

test('check is explicit and backend success never claims Pi Internet is connected', async () => {
  const checkBackend = jest.fn(async () => ({ checkedAt: Date.now(), reachable: true }));
  render(<DeviceSetup authorized checkBackend={checkBackend} config={config} />);
  expect(checkBackend).not.toHaveBeenCalled();
  choose('Connection checks');
  expect(checkBackend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check backend' }));
  await screen.findByText('Reachable');
  expect(checkBackend).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/^Connected$/)).not.toBeInTheDocument();
  expect(screen.getByText('See device report')).toBeInTheDocument();
});

test('failed check is actionable without displaying transport secrets', async () => {
  render(<DeviceSetup authorized config={config} checkBackend={async () => { throw new Error('never-show-fixture-secret'); }} />);
  choose('Connection checks'); fireEvent.click(screen.getByRole('button', { name: 'Check backend' }));
  await screen.findByText('Check failed');
  expect(screen.getByRole('status')).toHaveTextContent('No device changes were sent');
  expect(document.body.textContent).not.toContain('never-show-fixture-secret');
});

test('backend address missing keeps check disabled', async () => {
  render(<DeviceSetup authorized config={{ configured: false }} />);
  choose('Connection checks');
  expect(screen.getByRole('button', { name: 'Check backend' })).toBeDisabled();
  expect(screen.getByText('Not configured')).toBeInTheDocument();
});

test('GPS source is device-scoped, uses original time, retains stale label and adds no requests', async () => {
  const now = Date.parse('2026-10-18T00:00:10Z');
  const gpsByBusId = { first: { deviceId: 'GPS-001', latitude: 14, longitude: 121, online: true,
    gpsUpdatedAt: '2026-10-13T00:00:00Z', deviceUpdatedAt: now }, second: { deviceId: 'GPS-002', latitude: 14, longitude: 121,
    gpsUpdatedAt: '2026-10-18T00:00:09Z' } };
  const checkBackend = jest.fn();
  render(<DeviceSetup authorized nowMs={now} gpsByBusId={gpsByBusId} checkBackend={checkBackend} />);
  choose('GPS status');
  expect(screen.getByText('Stale capture')).toBeInTheDocument();
  expect(screen.getByText('2026-10-13T00:00:00.000Z')).toBeInTheDocument();
  expect(screen.getByText('5d ago')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Configure Pi2 GPS-002' }));
  expect(screen.getByText('Recent capture')).toBeInTheDocument(); expect(screen.getByText('second')).toBeInTheDocument();
  expect(checkBackend).not.toHaveBeenCalled();
});

test('tab keyboard navigation, disabled scanner and responsive layout keep controls accessible', async () => {
  const view = render(<DeviceSetup authorized />);
  const networkTab = screen.getByRole('tab', { name: 'Wi-Fi & Internet' });
  fireEvent.keyDown(networkTab, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Connection checks' })).toHaveFocus();
  expect(screen.getByRole('tab', { name: 'Connection checks' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(document.activeElement, { key: 'End' });
  expect(screen.getByRole('heading', { name: 'GPS-001 GPS status' })).toBeInTheDocument();
  fireEvent.keyDown(document.activeElement, { key: 'Home' });
  expect(screen.getByRole('button', { name: 'Scan networks' })).toBeDisabled();
  expect(view.container.querySelector('[aria-label="Choose a device"]')).toHaveClass('sm:grid-cols-2');
  expect(view.container.querySelector('[aria-labelledby="device-setup-title"]')).toHaveClass('min-w-0', 'overflow-hidden');
  await screen.findByRole('button', { name: 'Refresh status' });
});

test('switching devices or leaving network tab erases draft credentials', async () => {
  render(<DeviceSetup authorized />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Wi-Fi Network' }));
  let password = screen.getByLabelText('Wi-Fi password');
  fireEvent.change(password, { target: { value: 'synthetic-only-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Configure Pi2 GPS-002' }));
  expect(password.value).toBe(''); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Configure Pi1 GPS-001' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Wi-Fi Network' }));
  password = screen.getByLabelText('Wi-Fi password');
  fireEvent.change(password, { target: { value: 'synthetic-only-password' } });
  choose('GPS status');
  expect(password.value).toBe(''); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('auth loss and unmount abort owned check and ignore late result', async () => {
  let resolve;
  const checkBackend = jest.fn(() => new Promise((done) => { resolve = done; }));
  const view = render(<DeviceSetup authorized config={config} checkBackend={checkBackend} />);
  choose('Connection checks'); fireEvent.click(screen.getByRole('button', { name: 'Check backend' }));
  const signal = checkBackend.mock.calls[0][0].signal;
  view.rerender(<DeviceSetup config={config} checkBackend={checkBackend} />);
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ checkedAt: Date.now(), reachable: true }));
  view.rerender(<DeviceSetup authorized config={config} checkBackend={checkBackend} />);
  expect(screen.queryByText('Reachable')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Check backend' }));
  const next = checkBackend.mock.calls[1][0].signal;
  view.unmount(); expect(next.aborted).toBe(true);
  await act(async () => resolve({ checkedAt: Date.now(), reachable: true }));
});

test('old backend success expires instead of staying connected forever', async () => {
  jest.useFakeTimers();
  try {
    render(<DeviceSetup authorized config={config} checkBackend={async () => ({ checkedAt: Date.now(), reachable: true })} />);
    choose('Connection checks');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Check backend' })));
    expect(screen.getByText('Reachable')).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(20000));
    expect(within(screen.getByRole('tabpanel')).queryByText('Reachable')).not.toBeInTheDocument();
    expect(within(screen.getByRole('tabpanel')).getAllByText('Not verified')).toHaveLength(2);
  } finally { jest.useRealTimers(); }
});

test('remote Wi-Fi uses its authenticated agent status instead of the unrelated setup-presence indicator', async () => {
  const remoteWifiService = { enabled: true, read: jest.fn(async () => ({ deviceId: 'GPS-001', online: false })) };
  render(<DeviceSetup authorized config={config} remoteWifiService={remoteWifiService} />);
  await screen.findByText('GPS-001 — Unknown / agent unavailable');
  expect(screen.queryByText('GPS-001 setup connection')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Scan Pi networks' })).toBeDisabled();
});
