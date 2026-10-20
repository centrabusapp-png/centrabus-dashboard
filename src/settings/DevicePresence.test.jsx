import { act, render, screen, waitFor } from '@testing-library/react';
import DevicePresence from './DevicePresence';
import { createDevicePresenceService, publicPresence, pendingPresenceService } from './devicePresenceService';
const { TextEncoder } = require('util');
global.TextEncoder = TextEncoder;
const time = '2026-10-18T00:00:00.000Z';
const raw = () => ({ ok: true, scope: 'setup-presence-only', serverTime: time, devices: [
  { deviceId: 'GPS-001', reporting: true, lastSeenAt: time, wifiConnected: true, internet: 'unknown' },
  { deviceId: 'GPS-002', reporting: false, lastSeenAt: null, wifiConnected: null, internet: 'unknown' },
] });
const config = { configured: true, origin: 'http://192.168.50.10:5000', devicePresenceEnabled: true };
const session = async () => ({ data: { session: { access_token: 'synthetic-admin' } } });
const response = (body) => ({ ok: true, headers: { get: (key) => key === 'content-type' ? 'application/json' : null }, text: async () => JSON.stringify(body) });

test('disabled mode never requests Auth or backend status', async () => {
  const fetchImpl = jest.fn(), getSession = jest.fn();
  const service = createDevicePresenceService({ config: { devicePresenceEnabled: false }, fetchImpl, getSession });
  expect(service).toBe(pendingPresenceService); await service.read();
  expect(fetchImpl).not.toHaveBeenCalled(); expect(getSession).not.toHaveBeenCalled();
});
test('only bounded authorized read is sent; secret fields are not forwarded to UI', async () => {
  const value = raw(); value.devices[0].secret = 'never-display';
  const fetchImpl = jest.fn(async () => response(value));
  const result = await createDevicePresenceService({ config, getSession: session, fetchImpl }).read();
  expect(fetchImpl).toHaveBeenCalledWith(config.origin + '/api/device-presence', expect.objectContaining({ method: 'GET',
    cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json', Authorization: 'Bearer synthetic-admin' } }));
  expect(JSON.stringify(result)).not.toContain('never-display');
});
test('missing session and backend failure remain unavailable without leaking transport details', async () => {
  const fetchImpl = jest.fn(async () => { throw new Error('never-display'); });
  await expect(createDevicePresenceService({ config, getSession: async () => ({}), fetchImpl }).read()).rejects.toThrow('Setup presence unavailable');
  expect(fetchImpl).not.toHaveBeenCalled();
  await expect(createDevicePresenceService({ config, getSession: session, fetchImpl }).read()).rejects.not.toThrow('never-display');
});
test('duplicates, malformed UTC and unknown identities are rejected', () => {
  for (const change of [(v) => { v.devices[1] = v.devices[0]; }, (v) => { v.serverTime = '2026-10-18'; },
    (v) => { v.devices[1].deviceId = 'GPS-003'; }, (v) => { v.devices[0].lastSeenAt = '2026-02-30T00:00:00.000Z'; }]) {
    const value = raw(); change(value); expect(() => publicPresence(value)).toThrow();
  }
});
test('oversized response fails closed', async () => {
  const fetchImpl = async () => response({ padding: 'x'.repeat(9000) });
  await expect(createDevicePresenceService({ config, getSession: session, fetchImpl }).read()).rejects.toThrow('Setup presence unavailable');
});
test('unauthorized component does not poll or render device information', () => {
  const service = { read: jest.fn() }; render(<DevicePresence service={service} deviceId="GPS-001" />);
  expect(service.read).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Pi setup check-in')).not.toBeInTheDocument();
});
test('setup check-in never claims GPS freshness or that another Pi is connected', async () => {
  const service = { read: jest.fn(async () => publicPresence(raw())) };
  const view = render(<DevicePresence authorized service={service} deviceId="GPS-001" />);
  await screen.findByText('Setup online');
  expect(screen.getByText(/not GPS freshness/)).toBeInTheDocument();
  view.rerender(<DevicePresence authorized service={service} deviceId="GPS-002" />);
  expect(screen.getByText('Not reporting')).toBeInTheDocument(); expect(service.read).toHaveBeenCalledTimes(1);
});
test('stale and future reports never show Setup online', async () => {
  for (const seen of ['2026-10-17T00:00:00.000Z', '2026-10-18T00:00:01.000Z']) {
    const value = raw(); value.devices[0].lastSeenAt = seen;
    const view = render(<DevicePresence authorized deviceId="GPS-001" service={{ read: async () => publicPresence(value) }} />);
    await waitFor(() => expect(screen.getByText('Not reporting')).toBeInTheDocument());
    expect(screen.queryByText('Setup online')).not.toBeInTheDocument(); view.unmount();
  }
});
test('unmount aborts pending status request and late resolution does not update', async () => {
  let signal, resolve;
  const service = { read: jest.fn((args) => { signal = args.signal; return new Promise((done) => { resolve = done; }); }) };
  const view = render(<DevicePresence authorized service={service} deviceId="GPS-001" />);
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => resolve(publicPresence(raw())));
});
test('failed check-in status suppresses previous online state', async () => {
  const service = { read: jest.fn(async () => { throw new Error('fixture'); }) };
  render(<DevicePresence authorized service={service} deviceId="GPS-001" />);
  await screen.findByText(/status unavailable/); expect(screen.getByText('Not reporting')).toBeInTheDocument();
});
