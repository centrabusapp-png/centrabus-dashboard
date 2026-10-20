import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { deriveSystemHealth, getBusCoordinates, getMarkerGpsFreshness, getGpsSampleTimestamp, useLiveGps } from './App';
import { supabase } from './supabase';

jest.mock('react-leaflet', () => ({}));
jest.mock('./supabase', () => ({
  supabase: { from: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() },
}));

let channels;
let liveRead;

test('existing read and realtime payload preserve explicit device identity without extra queries', async () => {
  liveRead = Promise.resolve({ data: [
    { bus_id: 'a', device_id: 'GPS-001', latitude: 14.1, longitude: 121.1, gps_updated_at: '2026-10-18T00:00:00Z' },
    { bus_id: 'b', device_id: 'GPS-002', latitude: 14.2, longitude: 121.2, gps_updated_at: '2026-10-18T00:00:00Z' },
  ], error: null });
  const { result } = renderHook(() => useLiveGps(['a', 'b']));
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  expect(result.current.gpsByBusId.a.deviceId).toBe('GPS-001');
  expect(result.current.gpsByBusId.b.deviceId).toBe('GPS-002');
  act(() => channels[0].onData({ eventType: 'UPDATE', new: { bus_id: 'b', device_id: 'GPS-002', latitude: 14.3, longitude: 121.2,
    gps_updated_at: '2026-10-18T00:00:01Z' } }));
  expect(result.current.gpsByBusId.a.deviceId).toBe('GPS-001');
  expect(result.current.gpsByBusId.b.deviceId).toBe('GPS-002');
  expect(supabase.from).toHaveBeenCalledTimes(1);
  expect(supabase.channel).toHaveBeenCalledTimes(1);
});

test('startup keeps an old saved location stale and switches only on a genuinely newer GPS observation', async () => {
  const old = { bus_id: 'a', latitude: 14.1, longitude: 121.1, online: true, gps_updated_at: '2026-10-09T00:00:00Z' };
  liveRead = Promise.resolve({ data: [old], error: null });
  const { result } = renderHook(() => useLiveGps(['a']));
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  const now = Date.parse('2026-10-10T00:00:00Z');
  expect(getBusCoordinates({ gps: result.current.gpsByBusId.a })).toEqual({ lat: 14.1, lng: 121.1 });
  expect(getMarkerGpsFreshness({ gps: result.current.gpsByBusId.a }, now).ageMs).toBe(86400000);
  expect(deriveSystemHealth({ gpsByBusId: result.current.gpsByBusId, nowMs: now }).gps.status).toBe('STALE');
  act(() => channels[0].onData({ eventType: 'UPDATE', new: { ...old, latitude: 14.2, gps_updated_at: '2026-10-10T00:00:00Z' } }));
  expect(getBusCoordinates({ gps: result.current.gpsByBusId.a })).toEqual({ lat: 14.2, lng: 121.1 });
  expect(getMarkerGpsFreshness({ gps: result.current.gpsByBusId.a }, now).ageMs).toBe(0);
});

test('an absent snapshot row retains the known marker as unavailable until a newer fix arrives', async () => {
  const original = { bus_id: 'a', latitude: 14.1, longitude: 121.1, online: true, gps_updated_at: '2026-10-09T00:00:00Z' };
  liveRead = Promise.resolve({ data: [original], error: null });
  const { result, rerender } = renderHook(({ ids }) => useLiveGps(ids), { initialProps: { ids: ['a'] } });
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  liveRead = Promise.resolve({ data: [], error: null });
  await act(async () => channels[0].onStatus('SUBSCRIBED'));
  expect(result.current.gpsByBusId.a).toMatchObject({ sourceUnavailable: true, online: false, gpsUpdatedAt: original.gps_updated_at });
  expect(getBusCoordinates({ gps: result.current.gpsByBusId.a })).toEqual({ lat: 14.1, lng: 121.1 });
  expect(deriveSystemHealth({ gpsByBusId: result.current.gpsByBusId, nowMs: Date.parse('2026-10-09T00:00:10Z') }).gps.status).toBe('STALE');
  act(() => channels[0].onData({ eventType: 'UPDATE', new: { ...original, latitude: 14.2, gps_updated_at: '2026-10-09T00:00:12Z' } }));
  expect(result.current.gpsByBusId.a.sourceUnavailable).not.toBe(true);
  expect(result.current.gpsByBusId.a.latitude).toBe(14.2);
  rerender({ ids: [] });
  expect(result.current.gpsByBusId.a).toBeUndefined();
});

test('failed catch-up retries on a still-subscribed channel and cancels all retries on unmount', async () => {
  jest.useFakeTimers();
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    liveRead = Promise.resolve({ data: null, error: { code: 'network-error' } });
    const { result, unmount } = renderHook(() => useLiveGps());
    await act(async () => channels[0].onStatus('SUBSCRIBED'));
    expect(result.current.realtime.readStatus).toBe('ERROR');
    liveRead = Promise.resolve({ data: [{ bus_id: 'a', latitude: 14.1, longitude: 121.1 }], error: null });
    await act(async () => jest.advanceTimersByTime(1000));
    expect(result.current.realtime.readStatus).toBe('READY');
    expect(result.current.gpsByBusId.a.latitude).toBe(14.1);
    expect(channels).toHaveLength(1);
    unmount();
    const reads = supabase.from.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(30000); window.dispatchEvent(new Event('online')); });
    expect(supabase.from).toHaveBeenCalledTimes(reads);
  } finally { jest.useRealTimers(); log.mockRestore(); }
});

test('read retries are bounded and browser online performs a fresh catch-up without another channel', async () => {
  jest.useFakeTimers();
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    liveRead = Promise.resolve({ data: null, error: { code: 'network-error' } });
    const { result } = renderHook(() => useLiveGps());
    await waitFor(() => expect(result.current.realtime.readStatus).toBe('ERROR'));
    for (const delay of [1000, 3000, 10000]) await act(async () => jest.advanceTimersByTime(delay));
    expect(supabase.from).toHaveBeenCalledTimes(4);
    await act(async () => jest.advanceTimersByTime(30000));
    expect(supabase.from).toHaveBeenCalledTimes(4);
    liveRead = Promise.resolve({ data: [{ bus_id: 'a', latitude: 14.1, longitude: 121.1 }], error: null });
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(result.current.realtime.readStatus).toBe('READY');
    expect(supabase.channel).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); log.mockRestore(); }
});

test('deleting an invalid newer row cannot retimestamp its older cached valid location', async () => {
  const { result } = renderHook(() => useLiveGps());
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  const capture = '2026-10-09T00:00:00Z';
  act(() => channels[0].onData({ eventType: 'UPDATE', new: { bus_id: 'a', latitude: 14.1, longitude: 121.1, gps_updated_at: capture } }));
  act(() => channels[0].onData({ eventType: 'UPDATE', new: { bus_id: 'a', latitude: null, longitude: null, gps_updated_at: '2026-10-09T00:01:00Z' } }));
  act(() => channels[0].onData({ eventType: 'DELETE', old: { bus_id: 'a' } }));
  expect(result.current.gpsByBusId.a.lastKnownPosition.capturedAt).toBe(Date.parse(capture));
  expect(getMarkerGpsFreshness({ gps: result.current.gpsByBusId.a }, Date.parse('2026-10-09T00:02:00Z')).ageMs).toBe(120000);
  expect(deriveSystemHealth({ gpsByBusId: result.current.gpsByBusId, nowMs: Date.parse('2026-10-09T00:02:00Z') }).gps.timestampMs).toBe(Date.parse(capture));
});

beforeEach(() => {
  jest.clearAllMocks();
  channels = [];
  liveRead = Promise.resolve({ data: [], error: null });
  supabase.from.mockImplementation(() => {
    const query = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      order: jest.fn(() => query),
      limit: jest.fn(() => query),
      abortSignal: jest.fn((signal) => { query.signal = signal; return query; }),
      then: (resolve, reject) => liveRead.then(resolve, reject),
    };
    return query;
  });
  supabase.channel.mockImplementation((name) => {
    const channel = {
      name,
      on: jest.fn((event, filter, callback) => { channel.onData = callback; return channel; }),
      subscribe: jest.fn((callback) => { channel.onStatus = callback; return channel; }),
    };
    channels.push(channel);
    return channel;
  });
  supabase.removeChannel.mockResolvedValue('ok');
});

test('existing live channel exposes pending, subscription, error, closed and recovery without duplicates', async () => {
  const { result, rerender } = renderHook(() => useLiveGps());
  expect(result.current.realtime.channelStatus).toBe('PENDING');
  expect(supabase.channel).toHaveBeenCalledTimes(1);
  expect(channels[0].name).toBe('live-bus-positions-dashboard');
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));

  for (const status of ['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED', 'SUBSCRIBED']) {
    await act(async () => channels[0].onStatus(status));
    expect(result.current.realtime.channelStatus).toBe(status);
    expect(result.current.realtime.changedAt).toEqual(expect.any(Number));
  }
  rerender();
  expect(supabase.channel).toHaveBeenCalledTimes(1);
  expect(channels[0].subscribe).toHaveBeenCalledTimes(1);
});

test('initial read arriving after subscription retains channel state and does not invent a Realtime event', async () => {
  let resolveRead;
  liveRead = new Promise((resolve) => { resolveRead = resolve; });
  const { result } = renderHook(() => useLiveGps());
  await act(async () => channels[0].onStatus('SUBSCRIBED'));
  await act(async () => resolveRead({ data: [], error: null }));
  expect(result.current.realtime).toMatchObject({ channelStatus: 'SUBSCRIBED', readStatus: 'READY', lastEventAt: null });
});

test('new positions and deletes preserve channel status and actual source capture timestamps', async () => {
  const { result } = renderHook(() => useLiveGps());
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  await act(async () => channels[0].onStatus('SUBSCRIBED'));
  const capturedAt = '2026-10-03T00:00:00.000Z';
  act(() => channels[0].onData({
    eventType: 'UPDATE',
    new: { bus_id: 'test-bus', latitude: 14.095, longitude: 121.16, speed: 0, online: true, gps_updated_at: capturedAt },
  }));
  expect(result.current.gpsByBusId['test-bus'].gpsUpdatedAt).toBe(capturedAt);
  expect(getGpsSampleTimestamp(result.current.gpsByBusId['test-bus'])).toBe(Date.parse(capturedAt));
  expect(result.current.realtime.channelStatus).toBe('SUBSCRIBED');
  expect(result.current.realtime.lastEventAt).toEqual(expect.any(Number));
  act(() => channels[0].onData({ eventType: 'DELETE', old: { bus_id: 'test-bus' } }));
  expect(result.current.gpsByBusId['test-bus']).toMatchObject({ online: false, sourceUnavailable: true, gpsUpdatedAt: capturedAt });
  expect(getBusCoordinates({ gps: result.current.gpsByBusId['test-bus'] })).toEqual({ lat: 14.095, lng: 121.16 });
  expect(result.current.realtime.channelStatus).toBe('SUBSCRIBED');
});

test('initial read failure remains explicit even with a subscribed channel', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    liveRead = Promise.resolve({ data: null, error: { message: 'Read denied' } });
    const { result } = renderHook(() => useLiveGps());
    act(() => channels[0].onStatus('SUBSCRIBED'));
    await waitFor(() => expect(result.current.realtime.readStatus).toBe('ERROR'));
    expect(result.current.realtime.channelStatus).toBe('SUBSCRIBED');
  } finally { log.mockRestore(); }
});

test('cleanup removes exactly the owned live channel and ignores late data/status/read callbacks', async () => {
  let resolveRead;
  liveRead = new Promise((resolve) => { resolveRead = resolve; });
  const { result, unmount } = renderHook(() => useLiveGps());
  const snapshot = result.current;
  const channel = channels[0];
  const query = supabase.from.mock.results[0].value;
  unmount();
  expect(query.signal.aborted).toBe(true);
  expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  await act(async () => {
    channel.onStatus('SUBSCRIBED');
    channel.onData({ eventType: 'DELETE', old: { bus_id: 'test-bus' } });
    resolveRead({ data: [], error: null });
  });
  expect(result.current).toBe(snapshot);
});

test('live GPS hook stays independent of bus-list rerenders and does not subscribe to history', async () => {
  const { result, rerender, unmount } = renderHook(({ ids }) => useLiveGps(ids), { initialProps: { ids: ['bus-a'] } });
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  const [liveChannel] = channels;
  await act(async () => liveChannel.onStatus('SUBSCRIBED'));
  rerender({ ids: ['bus-b'] });
  expect(channels).toHaveLength(1);
  expect(supabase.from).toHaveBeenCalledTimes(2); // initial snapshot + channel-join catch-up
  expect(supabase.channel).toHaveBeenCalledTimes(1);
  expect(supabase.removeChannel).not.toHaveBeenCalled();
  expect(result.current.realtime.channelStatus).toBe('SUBSCRIBED');
  unmount();
  expect(supabase.removeChannel.mock.calls.map(([channel]) => channel)).toEqual([liveChannel]);
});

test('Strict Mode replacement ignores closed/subscribed callbacks from the disposed channel', async () => {
  const { result } = renderHook(() => useLiveGps(), { wrapper: StrictMode });
  expect(channels).toHaveLength(2);
  const [disposedChannel, activeChannel] = channels;
  expect(supabase.removeChannel).toHaveBeenCalledWith(disposedChannel);
  expect(result.current.realtime.channelStatus).toBe('PENDING');
  await act(async () => activeChannel.onStatus('SUBSCRIBED'));
  act(() => disposedChannel.onStatus('CLOSED'));
  act(() => disposedChannel.onStatus('SUBSCRIBED'));
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  expect(result.current.realtime.channelStatus).toBe('SUBSCRIBED');
});

test('initial read cannot erase newer Realtime positions or resurrect a deleted bus', async () => {
  let resolveRead;
  liveRead = new Promise((resolve) => { resolveRead = resolve; });
  const { result } = renderHook(() => useLiveGps());
  act(() => {
    channels[0].onData({ eventType: 'UPDATE', new: { bus_id: 'a', latitude: 14.11, longitude: 121.11 } });
    channels[0].onData({ eventType: 'INSERT', new: { bus_id: 'd', latitude: 14.4, longitude: 121.4 } });
    channels[0].onData({ eventType: 'DELETE', old: { bus_id: 'c' } });
  });
  await act(async () => resolveRead({ data: [
    { bus_id: 'a', latitude: 14.1, longitude: 121.1 },
    { bus_id: 'b', latitude: 14.2, longitude: 121.2 },
    { bus_id: 'c', latitude: 14.3, longitude: 121.3 },
  ], error: null }));
  expect(result.current.gpsByBusId.a.latitude).toBe(14.11);
  expect(result.current.gpsByBusId.b.latitude).toBe(14.2);
  expect(result.current.gpsByBusId.d.latitude).toBe(14.4);
  expect(result.current.gpsByBusId.c).toBeUndefined();
  expect(supabase.channel).toHaveBeenCalledTimes(1);
});

test('initial read error does not erase an already received valid Realtime fix', async () => {
  let resolveRead;
  liveRead = new Promise((resolve) => { resolveRead = resolve; });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const { result } = renderHook(() => useLiveGps());
  try {
    act(() => channels[0].onData({ eventType: 'UPDATE', new: { bus_id: 'a', latitude: 14.1, longitude: 121.1 } }));
    await act(async () => resolveRead({ data: null, error: { message: 'Read failed' } }));
    expect(result.current.gpsByBusId.a.latitude).toBe(14.1);
    expect(result.current.realtime.readStatus).toBe('ERROR');
  } finally { log.mockRestore(); }
});

test('updates for A and B preserve the other bus and Realtime recovery requires no new channel', async () => {
  liveRead = Promise.resolve({ data: [
    { bus_id: 'a', latitude: 14.1, longitude: 121.1 },
    { bus_id: 'b', latitude: 14.2, longitude: 121.2 },
  ], error: null });
  const { result } = renderHook(() => useLiveGps());
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  act(() => channels[0].onData({ eventType: 'UPDATE', new: { bus_id: 'a', latitude: 14.11, longitude: 121.11 } }));
  expect(result.current.gpsByBusId.b.latitude).toBe(14.2);
  act(() => channels[0].onData({ eventType: 'UPDATE', new: { bus_id: 'b', latitude: 14.22, longitude: 121.22 } }));
  expect(result.current.gpsByBusId.a.latitude).toBe(14.11);
  await act(async () => channels[0].onStatus('CHANNEL_ERROR'));
  await act(async () => channels[0].onStatus('SUBSCRIBED'));
  expect(Object.keys(result.current.gpsByBusId).sort()).toEqual(['a', 'b']);
  expect(supabase.channel).toHaveBeenCalledTimes(1);
});

test('invalid update retains only previously observed coordinates with original GPS age', async () => {
  const captured = '2026-10-03T00:00:00Z';
  liveRead = Promise.resolve({ data: [{ bus_id: 'a', latitude: 14.1, longitude: 121.1, online: true, gps_updated_at: captured }], error: null });
  const { result } = renderHook(() => useLiveGps());
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  act(() => channels[0].onData({ eventType: 'UPDATE', new: { bus_id: 'a', latitude: null, longitude: null, online: false, gps_updated_at: '2026-10-03T00:02:00Z' } }));
  const gps = result.current.gpsByBusId.a;
  expect(gps.latitude).toBeNull(); // actual incoming values remain authoritative
  expect(gps.lastKnownPosition).toEqual({ lat: 14.1, lng: 121.1, capturedAt: Date.parse(captured) });
  expect(getBusCoordinates({ gps })).toEqual({ lat: 14.1, lng: 121.1 });
  expect(getMarkerGpsFreshness({ gps }, Date.parse('2026-10-03T00:02:00Z'))).toMatchObject({ status: 'Offline', ageMs: 120000 });
  act(() => channels[0].onData({ eventType: 'INSERT', new: { bus_id: 'never-valid', latitude: null, longitude: null } }));
  expect(getBusCoordinates({ gps: result.current.gpsByBusId['never-valid'] })).toBeNull();
});

test('older/duplicate Realtime fixes cannot replace coordinates or route and heartbeat cannot refresh GPS age', async () => {
  const { result } = renderHook(() => useLiveGps());
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  const latest = { bus_id: 'a', latitude: 14.2, longitude: 121.2, speed: 30, online: true,
    gps_updated_at: '2026-10-05T00:00:12Z', device_updated_at: '2026-10-05T00:00:13Z', route_status: 'ON ROUTE' };
  act(() => channels[0].onData({ eventType: 'UPDATE', new: latest }));
  for (const capture of ['2026-10-05T00:00:10Z', latest.gps_updated_at, null]) {
    act(() => channels[0].onData({ eventType: 'UPDATE', new: { ...latest, gps_updated_at: capture, updated_at: null,
      latitude: 14.9, route_status: 'CONFIRMED DEVIATION', device_updated_at: '2026-10-05T00:00:15Z' } }));
    expect(result.current.gpsByBusId.a.latitude).toBe(14.2);
    expect(result.current.gpsByBusId.a.routeStatus).toBe('ON ROUTE');
    expect(getGpsSampleTimestamp(result.current.gpsByBusId.a)).toBe(Date.parse(latest.gps_updated_at));
  }
  expect(result.current.gpsByBusId.a.deviceUpdatedAt).toBe('2026-10-05T00:00:15Z');
});

test('heartbeat-only placeholder cannot manufacture fresh GPS from its database timestamp', async () => {
  const currentTime = new Date().toISOString();
  liveRead = Promise.resolve({ data: [{ bus_id: 'a', online: false, gps_updated_at: null, updated_at: currentTime, device_updated_at: currentTime }], error: null });
  const { result } = renderHook(() => useLiveGps());
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  expect(getGpsSampleTimestamp(result.current.gpsByBusId.a)).toBeNull();
  expect(deriveSystemHealth({ gpsByBusId: result.current.gpsByBusId }).gps.status).toBe('NO DATA');
});

test('rejoining catches up missed fixes once without polling or duplicate channels', async () => {
  const { result } = renderHook(() => useLiveGps());
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  await act(async () => channels[0].onStatus('SUBSCRIBED'));
  liveRead = Promise.resolve({ data: [{ bus_id: 'b', latitude: 14.3, longitude: 121.3, gps_updated_at: '2026-10-05T00:00:13Z' }], error: null });
  await act(async () => { channels[0].onStatus('CHANNEL_ERROR'); channels[0].onStatus('SUBSCRIBED'); });
  expect(result.current.gpsByBusId.b.latitude).toBe(14.3);
  const readCount = supabase.from.mock.calls.length;
  await act(async () => channels[0].onStatus('SUBSCRIBED'));
  expect(supabase.from).toHaveBeenCalledTimes(readCount);
  expect(supabase.channel).toHaveBeenCalledTimes(1);
});

test('catch-up snapshot cannot overwrite events or resurrect deletions received during that read', async () => {
  const { result } = renderHook(() => useLiveGps());
  await waitFor(() => expect(result.current.realtime.readStatus).toBe('READY'));
  let resolve;
  liveRead = new Promise((done) => { resolve = done; });
  act(() => channels[0].onStatus('SUBSCRIBED'));
  act(() => {
    channels[0].onData({ eventType: 'UPDATE', new: { bus_id: 'a', latitude: 14.4, longitude: 121.4, gps_updated_at: '2026-10-05T00:00:14Z' } });
    channels[0].onData({ eventType: 'DELETE', old: { bus_id: 'b' } });
  });
  await act(async () => resolve({ data: [{ bus_id: 'a', latitude: 14.1, longitude: 121.1 }, { bus_id: 'b', latitude: 14.2, longitude: 121.2 }], error: null }));
  expect(result.current.gpsByBusId.a.latitude).toBe(14.4);
  expect(result.current.gpsByBusId.b).toBeUndefined();
});
