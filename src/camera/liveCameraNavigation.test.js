import { act, renderHook } from '@testing-library/react';
import { useUrlState } from '../App';
jest.mock('react-leaflet', () => ({}));
jest.mock('../supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));

let original;
beforeEach(() => { original = window.location.pathname + window.location.search; });
afterEach(() => { window.history.replaceState(null, '', original); });

test('Live Camera View navigation has a stable direct path and survives reload', () => {
  window.history.replaceState(null, '', '/live-map?bus=test-bus');
  const view = renderHook(() => useUrlState());
  act(() => view.result.current.navigate({ page: 'live-camera' }));
  expect(window.location.pathname).toBe('/live-camera');
  expect(view.result.current.page).toBe('live-camera');
  expect(window.location.search).toBe('?bus=test-bus');
  view.unmount();
  const reloaded = renderHook(() => useUrlState());
  expect(reloaded.result.current.page).toBe('live-camera');
});

test('back/forward updates page and existing routes remain intact', () => {
  window.history.replaceState(null, '', '/live-camera');
  const { result } = renderHook(() => useUrlState());
  for (const [page, path] of [['map', '/live-map'], ['alerts', '/alerts'], ['vehicle-condition', '/vehicle-condition'], ['live-camera', '/live-camera']]) {
    act(() => result.current.navigate({ page }));
    expect(window.location.pathname).toBe(path); expect(result.current.page).toBe(page);
  }
  act(() => { window.history.replaceState(null, '', '/live-map?bus=preserved'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(result.current.page).toBe('map'); expect(result.current.busId).toBe('preserved');
});
