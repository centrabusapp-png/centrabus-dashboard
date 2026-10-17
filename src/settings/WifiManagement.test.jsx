import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WifiManagement from './WifiManagement';
import { pendingWifiState } from './wifiManagementModel';
const { TextEncoder } = require('util');
global.TextEncoder = TextEncoder;

async function open(service) {
  const view = render(<WifiManagement authorized service={service} />);
  await screen.findByRole('button', { name: 'Refresh status' });
  return view;
}
function add() { fireEvent.click(screen.getByRole('button', { name: 'Add Wi-Fi Network' })); }
function enter(ssid = 'Depot\'s & "Bus" <A>', secret = 'test-only-password') {
  fireEvent.change(screen.getByLabelText('Network SSID'), { target: { value: ssid } });
  fireEvent.change(screen.getByLabelText('Wi-Fi password'), { target: { value: secret } });
}
function review() { fireEvent.click(screen.getByRole('button', { name: 'Review change' })); }
function reported(overrides = {}) {
  return { ...pendingWifiState('GPS-001'), integration: 'ready', reportedAt: new Date().toISOString(),
    profiles: [{ ssid: 'Depot', priority: 50, security: 'wpa2-personal', password: 'never-display-device-secret' }], ...overrides };
}

test('unauthorized UI has no management controls or status calls', () => {
  const service = { getState: jest.fn() };
  render(<WifiManagement service={service} />);
  expect(screen.getByText(/Administrator access is required/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add Wi-Fi Network' })).not.toBeInTheDocument();
  expect(service.getState).not.toHaveBeenCalled();
});

test('simplified default screen has status and saved networks but no inline credential form or fabricated profiles', async () => {
  await open();
  expect(screen.getByRole('heading', { name: 'Wi-Fi Management' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Saved networks' })).toBeInTheDocument();
  expect(screen.getByText('Integration pending')).toBeInTheDocument();
  expect(screen.getByText(/Not available until the secure device agent/)).toBeInTheDocument();
  expect(screen.queryByText(/^Connected$/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Network SSID')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Wi-Fi password')).not.toBeInTheDocument();
  expect(screen.queryByText('Local network plans')).not.toBeInTheDocument();
});

test('Add dialog review clears password and cannot save, send or apply a device change', async () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem');
  const fetch = jest.spyOn(global, 'fetch');
  const service = { getState: jest.fn().mockResolvedValue(pendingWifiState('GPS-001')), apply: jest.fn() };
  const view = await open(service); add(); enter();
  const field = screen.getByLabelText('Wi-Fi password'); review();
  const modal = screen.getByRole('dialog');
  expect(within(modal).getByText('Depot\'s & "Bus" <A>')).toBeInTheDocument();
  expect(within(modal).getByRole('button', { name: 'Apply to device' })).toBeDisabled();
  expect(field.value).toBe('');
  expect(screen.queryByLabelText('Wi-Fi password')).not.toBeInTheDocument();
  expect(view.container.textContent).not.toContain('test-only-password');
  fireEvent.click(within(modal).getByRole('button', { name: 'Apply to device' }));
  expect(service.apply).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Save local plan/ })).not.toBeInTheDocument();
  fireEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('Depot\'s & "Bus" <A>')).not.toBeInTheDocument();
  expect(document.querySelector('svg[onload]')).toBeNull();
  storage.mockRestore(); fetch.mockRestore();
});

test('cancel, Escape and backdrop dismiss dialog and clear credentials without sending', async () => {
  await open(); add(); enter();
  const field = screen.getByLabelText('Wi-Fi password');
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(field.value).toBe('');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Wi-Fi Network' })).toHaveFocus();
  add(); enter(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  add(); fireEvent.click(screen.getByRole('dialog').parentElement);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('device switch never carries profile metadata or credentials to another Pi', async () => {
  const service = { getState: jest.fn((id) => Promise.resolve(id === 'GPS-001' ? reported() : pendingWifiState(id))) };
  await open(service); add(); enter('Unsaved'); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.change(screen.getByLabelText('GPS device'), { target: { value: 'GPS-002' } });
  await screen.findByRole('button', { name: 'Refresh status' });
  expect(screen.queryByText('Depot')).not.toBeInTheDocument();
  add();
  expect(screen.getByLabelText('Network SSID')).toHaveValue('');
  expect(screen.getByLabelText('Wi-Fi password')).toHaveValue('');
  expect(screen.getByText('GPS-002 · Preview only')).toBeInTheDocument();
});

test('dialog keyboard trap includes fields and restores focus after background inert is removed', async () => {
  await open(); add();
  const modal = screen.getByRole('dialog');
  const first = within(modal).getByRole('button', { name: 'Close network dialog' });
  const last = within(modal).getByRole('button', { name: 'Review change' });
  first.focus(); fireEvent.keyDown(modal, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus();
  fireEvent.keyDown(modal, { key: 'Tab' }); expect(first).toHaveFocus();
  expect(within(modal).getByLabelText('Network SSID')).toBeInTheDocument();
  fireEvent.click(first);
  expect(screen.getByRole('button', { name: 'Add Wi-Fi Network' })).toHaveFocus();
  expect(document.querySelector('[inert]')).toBeNull();
});

test('authorization loss clears secret field and removes management/dialog controls', async () => {
  const view = await open(); add(); enter();
  const field = screen.getByLabelText('Wi-Fi password');
  view.rerender(<WifiManagement authorized={false} />);
  expect(field.value).toBe('');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Wi-Fi password')).not.toBeInTheDocument();
  view.rerender(<WifiManagement authorized />);
  await screen.findByRole('button', { name: 'Refresh status' });
  add(); expect(screen.getByLabelText('Network SSID')).toHaveValue('');
});

test('Edit never reveals existing device password; review does not mutate reported profile', async () => {
  const service = { getState: jest.fn().mockResolvedValue(reported()), apply: jest.fn() };
  const view = await open(service);
  expect(view.container.textContent).not.toContain('never-display-device-secret');
  fireEvent.click(screen.getByRole('button', { name: 'Edit network Depot' }));
  expect(screen.getByRole('dialog', { name: 'Edit Wi-Fi Network' })).toBeInTheDocument();
  expect(screen.getByLabelText('Network SSID')).toHaveValue('Depot');
  expect(screen.getByLabelText('Wi-Fi password')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Network SSID'), { target: { value: 'Proposed depot' } });
  review(); expect(screen.getByRole('button', { name: 'Apply to device' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Depot')).toBeInTheDocument();
  expect(screen.queryByText('Proposed depot')).not.toBeInTheDocument();
  expect(service.apply).not.toHaveBeenCalled();
});

test('Priority preview requires review and never changes reported priority', async () => {
  await open({ getState: jest.fn().mockResolvedValue(reported()) });
  fireEvent.click(screen.getByRole('button', { name: 'Priority network Depot' }));
  expect(screen.getByLabelText('Network SSID')).toHaveAttribute('readonly');
  expect(screen.queryByLabelText('Wi-Fi password')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Priority (0–100)'), { target: { value: '80' } });
  review(); expect(screen.getByRole('button', { name: 'Update device priority' })).toBeDisabled();
  expect(within(screen.getByRole('dialog')).getByText('80')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('WPA2-Personal · Priority 50')).toBeInTheDocument();
});

test('Remove has explicit fallback confirmation and device deletion remains disabled', async () => {
  const service = { getState: jest.fn().mockResolvedValue(reported()), remove: jest.fn() };
  await open(service);
  fireEvent.click(screen.getByRole('button', { name: 'Remove network Depot' }));
  expect(screen.getByText('Confirm network removal')).toBeInTheDocument();
  expect(screen.getByText(/Never remove the last working network remotely/)).toBeInTheDocument();
  const action = screen.getByRole('button', { name: 'Remove from device' });
  expect(action).toBeDisabled(); fireEvent.click(action); expect(service.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Depot')).toBeInTheDocument();
});

test('invalid SSID or password is rejected and credential still cleared', async () => {
  await open(); add(); enter('x'.repeat(33)); review();
  expect(screen.getByRole('alert')).toHaveTextContent('1–32 UTF-8 bytes');
  expect(screen.getByLabelText('Wi-Fi password')).toHaveValue('');
  enter('Depot', 'short'); review();
  expect(screen.getByRole('alert')).toHaveTextContent('printable ASCII');
  expect(screen.getByRole('alert')).not.toHaveTextContent('short');
});

test('security change clears secret immediately', async () => {
  await open(); add(); enter();
  fireEvent.change(screen.getByLabelText('Security'), { target: { value: 'wpa3-personal' } });
  expect(screen.getByLabelText('Wi-Fi password')).toHaveValue('');
});

test.each(['pending', 'applied', 'failed', 'rollback_pending', 'rolled_back'])('device-reported configuration %s never enables Apply', async (configuration) => {
  const service = { getState: jest.fn().mockResolvedValue(reported({ configuration, wifiConnected: false, internetReachable: false })) };
  await open(service);
  const expected = { pending: 'Pending device confirmation', applied: 'Applied · device confirmed', failed: 'Configuration failed', rollback_pending: 'Rollback pending', rolled_back: 'Rolled back · device confirmed' };
  expect(screen.getByText(expected[configuration])).toBeInTheDocument();
  expect(screen.getByText('Disconnected')).toBeInTheDocument();
  add(); enter(); review(); expect(screen.getByRole('button', { name: 'Apply to device' })).toBeDisabled();
});

test('offline report shows unknown current Wi-Fi/internet, not historic Connected', async () => {
  await open({ getState: jest.fn().mockResolvedValue(reported({ reportedAt: new Date(Date.now() - 120_000).toISOString(), wifiConnected: true, internetReachable: true })) });
  expect(screen.getByText('Offline · last report expired')).toBeInTheDocument();
  expect(screen.queryByText(/^Connected$/)).not.toBeInTheDocument();
});

test('status expires without any extra query/subscription', async () => {
  jest.useFakeTimers();
  const service = { getState: jest.fn().mockResolvedValue(reported({ wifiConnected: true, internetReachable: true })) };
  const view = await open(service); expect(screen.getByText('Connected')).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(90_002); });
  expect(screen.getByText('Offline · last report expired')).toBeInTheDocument();
  expect(service.getState).toHaveBeenCalledTimes(1);
  view.unmount(); jest.useRealTimers();
});

test('manual Refresh makes one bounded read and never writes', async () => {
  const service = { getState: jest.fn().mockResolvedValue(reported()), apply: jest.fn() };
  await open(service); fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(service.getState).toHaveBeenCalledTimes(2));
  await screen.findByRole('button', { name: 'Refresh status' });
  expect(service.apply).not.toHaveBeenCalled();
});

test('adapter errors sanitized and mismatched device results never enter another selection', async () => {
  const service = { getState: jest.fn().mockRejectedValue(new Error('test-only-password')) };
  await open(service); expect(screen.getByRole('alert')).not.toHaveTextContent('test-only-password');
  service.getState.mockResolvedValue(reported());
  fireEvent.change(screen.getByLabelText('GPS device'), { target: { value: 'GPS-002' } });
  await screen.findByRole('button', { name: 'Refresh status' });
  expect(screen.queryByText('Depot')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('status is unavailable');
});

test('late device response ignored after switch', async () => {
  let finish;
  const service = { getState: jest.fn((id) => id === 'GPS-001' ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(pendingWifiState(id))) };
  const view = render(<WifiManagement authorized service={service} />);
  await waitFor(() => expect(service.getState).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('GPS device'), { target: { value: 'GPS-002' } });
  await screen.findByRole('button', { name: 'Refresh status' });
  await act(async () => finish(reported()));
  expect(screen.queryByText('Depot')).not.toBeInTheDocument(); view.unmount();
});

test('unmount clears password and aborts status request', async () => {
  let signal;
  const service = { getState: jest.fn((id, options) => { signal = options.signal; return Promise.resolve(pendingWifiState(id)); }) };
  const view = await open(service); add(); enter();
  const field = screen.getByLabelText('Wi-Fi password');
  view.unmount(); expect(field.value).toBe(''); expect(signal.aborted).toBe(true);
});

test('responsive summary and dialog avoid fixed widths and wrap actions', async () => {
  const view = await open();
  expect(view.container.querySelector('section')).toHaveClass('min-w-0');
  expect(view.container.querySelector('dl')).toHaveClass('grid-cols-2', 'lg:grid-cols-4');
  expect(screen.getByRole('button', { name: 'Add Wi-Fi Network' })).toHaveClass('w-full', 'sm:w-auto');
  add(); expect(screen.getByLabelText('Network SSID')).toHaveClass('min-w-0');
  expect(screen.getByRole('dialog')).toHaveClass('max-h-[90dvh]', 'overflow-y-auto');
});
