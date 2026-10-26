import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DeviceHealthPanel, { deviceTestRows } from './DeviceHealthPanel';
const now = Date.parse('2026-10-26T00:00:00Z');
test('one active Pi never makes the other Pi or a stale GPS fix active', () => {
  const rows = deviceTestRows([{ deviceId: 'GPS-001', gpsUpdatedAt: now - 15000, deviceUpdatedAt: now - 500 }], {
    'GPS-001': { state: 'live', frame: { device_id: 'GPS-001', camera_id: 'CAM-001', captured_at: new Date(now - 1000).toISOString() } },
  }, now);
  expect(rows[0]).toMatchObject({ activity: 'ACTIVE', gps: 'STALE', preview: 'ACTIVE' });
  expect(rows[1]).toMatchObject({ activity: 'NO RECENT DATA', gps: 'NO DATA', preview: 'NO RECENT FRAME' });
});
test('history, future frames and mismatched identities cannot assert an active camera', () => {
  for (const [state, device_id, captured_at] of [
    ['last-known', 'GPS-001', now], ['live', 'GPS-002', now], ['live', 'GPS-001', now + 5000],
  ]) expect(deviceTestRows([], { 'GPS-001': { state, frame: { device_id, camera_id: 'CAM-001', captured_at } } }, now)[0].preview).not.toBe('ACTIVE');
});
test('temporary mode is opt-in and polls metadata only for each camera', async () => {
  const service = { enabled: true, readLive: jest.fn(async () => ({ state: 'not-enrolled', frame: null })) };
  const view = render(<DeviceHealthPanel enabled={false} service={service} nowMs={now} />);
  expect(service.readLive).not.toHaveBeenCalled();
  view.rerender(<DeviceHealthPanel enabled service={service} nowMs={now} />);
  await waitFor(() => expect(service.readLive).toHaveBeenCalledTimes(2));
  expect(screen.getByText('GPS-001')).toBeInTheDocument();
  expect(screen.getByText('CAM-002')).toBeInTheDocument();
  expect(service.readLive.mock.calls.every(([, options]) => options.preview === false)).toBe(true);
  view.unmount();
});
