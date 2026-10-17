import { act, renderHook, waitFor } from '@testing-library/react';
import { useLiveBuses } from './App';
import { supabase } from './supabase';

jest.mock('react-leaflet', () => ({}));
jest.mock('./supabase', () => ({ supabase: { from: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() } }));
let channel;
let read;
beforeEach(() => {
  jest.clearAllMocks();
  read = Promise.resolve({ data: [], error: null });
  supabase.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query, order: () => query, then: (resolve, reject) => read.then(resolve, reject) };
    return query;
  });
  channel = { on: (_event, _filter, callback) => { channel.data = callback; return channel; }, subscribe: (callback) => { channel.status = callback; return channel; } };
  supabase.channel.mockReturnValue(channel);
});

test('delayed registry snapshot cannot erase a new bus or restore an archived bus', async () => {
  let resolve;
  read = new Promise((done) => { resolve = done; });
  const { result, unmount } = renderHook(() => useLiveBuses());
  act(() => {
    channel.data({ eventType: 'INSERT', new: { bus_id: 'a', plate_number: 'NEW', status: 'active' } });
    channel.data({ eventType: 'UPDATE', new: { bus_id: 'b', is_archived: true } });
  });
  await act(async () => resolve({ data: [{ bus_id: 'b', plate_number: 'OLD' }], error: null }));
  expect(result.current.buses.map((bus) => bus.id)).toEqual(['a']);
  unmount();
  expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
});

test('registry reconnect performs one catch-up without new subscriptions', async () => {
  const { result, rerender } = renderHook(() => useLiveBuses());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => channel.status('SUBSCRIBED'));
  read = Promise.resolve({ data: [{ bus_id: 'b', plate_number: 'NEW' }], error: null });
  await act(async () => { channel.status('CLOSED'); channel.status('SUBSCRIBED'); });
  expect(result.current.buses.map((bus) => bus.id)).toEqual(['b']);
  rerender();
  await act(async () => channel.status('SUBSCRIBED'));
  expect(supabase.channel).toHaveBeenCalledTimes(1);
  expect(supabase.from).toHaveBeenCalledTimes(3);
});

test('registry read failure retains an already received bus', async () => {
  let resolve;
  read = new Promise((done) => { resolve = done; });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const { result } = renderHook(() => useLiveBuses());
  try {
    act(() => channel.data({ eventType: 'INSERT', new: { bus_id: 'a', status: 'active' } }));
    await act(async () => resolve({ data: null, error: { code: 'TEST' } }));
    expect(result.current.buses.map((bus) => bus.id)).toEqual(['a']);
    expect(result.current.status).toBe('error');
  } finally { log.mockRestore(); }
});
