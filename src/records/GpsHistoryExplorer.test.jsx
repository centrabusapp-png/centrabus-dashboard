import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import GpsHistoryExplorer from './GpsHistoryExplorer';
import { __gpsHistoryTestState as gpsHistoryMock } from '../supabase';
import { __leafletTestState as leafletMock } from 'react-leaflet';

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
const originalMatchMedia = window.matchMedia;

jest.mock('react-leaflet', () => {
  const React = require('react');
  const map = { setView: jest.fn(), getZoom: () => 14 };
  const state = { mounts: 0, unmounts: 0, map };
  return {
    CircleMarker: ({ children }) => <div data-testid="historical-marker">{children}</div>,
    MapContainer: ({ children, className, style }) => {
      React.useEffect(() => {
        state.mounts += 1;
        return () => { state.unmounts += 1; };
      }, []);
      return <div data-testid="historical-map" className={className} style={style}>{children}</div>;
    },
    TileLayer: () => null,
    Tooltip: ({ children }) => <div>{children}</div>,
    useMap: () => map,
    __leafletTestState: state,
  };
});

jest.mock('../supabase', () => {
  const state = {
    rows: [], error: null, responses: [], queries: [],
    count: null, countError: null, countResponses: [], countQueries: [],
  };
  const supabase = {
    from: (table) => {
      const calls = [];
      const query = {};
      ['select', 'gte', 'lt', 'eq', 'in', 'order', 'range'].forEach((method) => {
        query[method] = (...args) => {
          calls.push([method, ...args]);
          return query;
        };
      });
      query.then = (resolve, reject) => {
        const selection = calls.find(([method]) => method === 'select');
        const range = calls.find(([method]) => method === 'range');
        const isHeadCount = selection?.[2]?.head === true;
        let response;
        if (isHeadCount) {
          state.countQueries.push({ table, calls });
          response = state.countResponses.length > 0
            ? state.countResponses.shift()
            : { data: null, count: Number.isInteger(state.count) ? state.count : state.rows.length, error: state.countError };
        } else {
          state.queries.push({ table, calls });
          response = state.responses.length > 0
            ? state.responses.shift()
            : {
              data: range ? state.rows.slice(range[1], range[2] + 1) : state.rows,
              error: state.error,
            };
        }
        return Promise.resolve(response).then(resolve, reject);
      };
      return query;
    },
  };
  return { supabase, __gpsHistoryTestState: state };
});

const bus = { id: 'bus-a', plateNumber: 'ABC 234', busCode: 'BUS 01', status: 'active' };

function row(id = '1', overrides = {}) {
  return {
    id,
    source_record_id: `source-${id}`,
    bus_id: 'bus-a',
    device_id: 'GPS-001',
    captured_at: '2026-10-04T05:00:00.000Z',
    created_at: '2026-10-04T05:00:02.000Z',
    latitude: 14.095,
    longitude: 121.16,
    speed: 35,
    route_status: 'ON ROUTE',
    distance_from_route_m: 12,
    diagnostics: {
      raw_speed_kmh: 35,
      movement_2s_m: 5,
      motion_status: 'MOVING',
      gps_quality: 'GOOD',
      filter_state: 'TRACKING',
      horizontal_accuracy_m: 4.5,
      consistency: 'CONSISTENT',
    },
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  gpsHistoryMock.rows = [];
  gpsHistoryMock.error = null;
  gpsHistoryMock.responses = [];
  gpsHistoryMock.queries = [];
  gpsHistoryMock.count = null;
  gpsHistoryMock.countError = null;
  gpsHistoryMock.countResponses = [];
  gpsHistoryMock.countQueries = [];
  leafletMock.mounts = 0;
  leafletMock.unmounts = 0;
  leafletMock.map.setView.mockClear();
  HTMLElement.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  else delete HTMLElement.prototype.scrollIntoView;
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  else delete window.matchMedia;
});

test('defaults to Today, All buses, Operational History, and page size 50', async () => {
  render(<GpsHistoryExplorer buses={[bus]} />);
  expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Filter by bus')).toHaveValue('all');
  expect(screen.getByLabelText('Records per page')).toHaveValue('50');
  expect(screen.getByRole('tab', { name: 'Operational History' })).toHaveAttribute('aria-selected', 'true');
  await screen.findByText('No GPS records for this selection');
});

test('initial read uses matching exact-count filters and a bounded PHT row range', async () => {
  gpsHistoryMock.rows = [row()];
  render(<GpsHistoryExplorer buses={[bus, { id: 'bus-b', plateNumber: 'XYZ 987' }, { id: 'bus-c', busCode: 'BUS 03' }]} />);
  await screen.findByText('ABC 234');

  // Fleet labels are supplied by existing app state; the count transfers no rows.
  expect(gpsHistoryMock.queries).toHaveLength(1);
  const { table, calls } = gpsHistoryMock.queries[0];
  expect(table).toBe('gps_history');
  expect(calls.some(([method, column]) => method === 'gte' && column === 'captured_at')).toBe(true);
  expect(calls.some(([method, column]) => method === 'lt' && column === 'captured_at')).toBe(true);
  expect(calls).toContainEqual(['range', 0, 49]);
  expect(calls).toContainEqual(['order', 'captured_at', { ascending: false }]);
  expect(calls).toContainEqual(['order', 'id', { ascending: false }]);
  expect(gpsHistoryMock.countQueries).toHaveLength(1);
  const countCalls = gpsHistoryMock.countQueries[0].calls;
  expect(countCalls).toContainEqual(['select', 'id', { count: 'exact', head: true }]);
  expect(countCalls.some(([method, column]) => method === 'gte' && column === 'captured_at')).toBe(true);
  expect(countCalls.some(([method, column]) => method === 'lt' && column === 'captured_at')).toBe(true);
  expect(countCalls.some(([method]) => method === 'range' || method === 'order')).toBe(false);
});

test.each([25, 100])('exact total and single-page wording show all 8 matches with page size %i', async (pageSize) => {
  window.sessionStorage.setItem('centrabus.gpsHistoryExplorer.filters', JSON.stringify({ pageSize }));
  gpsHistoryMock.rows = Array.from({ length: 8 }, (_, index) => row(String(index + 1)));
  render(<GpsHistoryExplorer buses={[bus]} />);

  expect(await screen.findByText('Showing 1–8 of 8 records')).toBeInTheDocument();
  expect(screen.getByText('Total records')).toBeInTheDocument();
  expect(screen.getByText('8 records')).toBeInTheDocument();
  expect(screen.queryByText('Rows per page is a maximum; filters may return fewer.')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Records per page')).toHaveValue(String(pageSize));
  expect(gpsHistoryMock.queries).toHaveLength(1);
  expect(gpsHistoryMock.queries[0].calls).toContainEqual(['range', 0, pageSize - 1]);
  expect(gpsHistoryMock.countQueries).toHaveLength(1);
  expect(gpsHistoryMock.countQueries[0].calls.find(([method]) => method === 'select')[2]).toEqual({ count: 'exact', head: true });
  expect(document.body.textContent).not.toMatch(/\$100|no full-period count|page-only summary/i);
  expect(document.body.textContent).not.toMatch(/Selected period:|Date boundaries use|Status filter:|CSV exports only the visible page/i);
  expect(document.body.textContent).not.toMatch(/Rows per page is a maximum/i);
  expect(screen.getByLabelText('Filter by status')).toHaveValue('all');
  expect(screen.queryByText('Showing all 8 matching records')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Previous GPS history page' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Next GPS history page' })).not.toBeInTheDocument();
});

test('capture period uses readable Philippine dates and marks timestamps as current-page-only', async () => {
  window.sessionStorage.setItem('centrabus.gpsHistoryExplorer.filters', JSON.stringify({
    preset: 'custom', startDate: '2026-09-28', endDate: '2026-10-04', pageSize: 25,
  }));
  gpsHistoryMock.rows = [
    row('2', { captured_at: '2026-10-04T05:00:00.000Z' }),
    row('1', { captured_at: '2026-10-03T05:00:00.000Z' }),
  ];
  gpsHistoryMock.count = 2;
  render(<GpsHistoryExplorer buses={[bus]} />);

  await screen.findByText('Showing 1–2 of 2 records');
  const summary = await screen.findByRole('region', { name: 'Filtered GPS history summary' });
  expect(within(summary).getByText('Sep 28 – Oct 4, 2026 / Philippine time')).toBeInTheDocument();
  expect(within(summary).getByText(/Current page ·/)).toHaveTextContent('Oct 3, 2026');
  expect(within(summary).getByText(/Current page ·/)).toHaveTextContent('Oct 4, 2026');
  expect(within(summary).getByText(/Current page ·/)).toHaveTextContent('Current page');
  expect(screen.getByText('Showing 1–2 of 2 records')).toBeInTheDocument();
  expect(screen.getByLabelText('Records per page')).toHaveValue('25');
  expect(gpsHistoryMock.queries).toHaveLength(1);
});

test('CSV action remains available without a persistent implementation note', async () => {
  gpsHistoryMock.rows = [row()];
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByRole('button', { name: 'Export current page CSV' });
  expect(document.body.textContent).not.toContain('CSV exports only the visible page');
});

test('bus and status changes issue new server-side filters', async () => {
  gpsHistoryMock.rows = [row()];
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('ABC 234');
  const recordRow = screen.getAllByRole('row').find((candidate) => candidate.textContent.includes('ABC 234'));
  fireEvent.click(recordRow);
  expect(screen.getByRole('region', { name: 'Historical GPS point' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Filter by bus'), { target: { value: 'bus-a' } });
  await waitFor(() => expect(gpsHistoryMock.queries).toHaveLength(2));
  await waitFor(() => expect(gpsHistoryMock.countQueries).toHaveLength(2));
  expect(gpsHistoryMock.queries[1].calls).toContainEqual(['eq', 'bus_id', 'bus-a']);
  expect(gpsHistoryMock.countQueries[1].calls).toContainEqual(['eq', 'bus_id', 'bus-a']);
  expect(screen.queryByRole('region', { name: 'Historical GPS point' })).not.toBeInTheDocument();

  gpsHistoryMock.rows = [];
  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'weakGps' } });
  await waitFor(() => expect(gpsHistoryMock.queries).toHaveLength(3));
  await waitFor(() => expect(gpsHistoryMock.countQueries).toHaveLength(3));
  expect(gpsHistoryMock.queries[2].calls).toContainEqual(['eq', 'diagnostics->>gps_quality', 'WEAK']);
  expect(gpsHistoryMock.queries[2].calls).toContainEqual(['range', 0, 49]);
  expect(gpsHistoryMock.countQueries[2].calls).toContainEqual(['eq', 'bus_id', 'bus-a']);
  expect(gpsHistoryMock.countQueries[2].calls).toContainEqual(['eq', 'diagnostics->>gps_quality', 'WEAK']);
  expect(screen.getByLabelText('Filter by status')).toHaveValue('weakGps');
  expect(screen.queryByText(/Status filter:/)).not.toBeInTheDocument();
  await screen.findByText('No GPS records for this selection');
});

test('selected status remains visible in its control without a duplicate status summary', async () => {
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('No GPS records for this selection');

  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'stopped' } });
  expect(screen.getByLabelText('Filter by status')).toHaveValue('stopped');
  expect(screen.queryByText(/Status filter:/)).not.toBeInTheDocument();
  await waitFor(() => expect(gpsHistoryMock.queries).toHaveLength(2));
  expect(gpsHistoryMock.queries[1].calls).toContainEqual(['eq', 'diagnostics->>motion_status', 'STOPPED']);
});

test('exact count is cached by filter key during the mounted session', async () => {
  gpsHistoryMock.rows = [row()];
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('Showing 1–1 of 1 records');
  expect(gpsHistoryMock.countQueries).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
  await screen.findByText('Showing 1–1 of 1 records');
  expect(gpsHistoryMock.countQueries).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  await screen.findByText('Showing 1–1 of 1 records');
  expect(gpsHistoryMock.countQueries).toHaveLength(2);
});

test('Operational History row selects the stored GPS point and labels it as historical, not live', async () => {
  gpsHistoryMock.rows = [row()];
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('ABC 234');
  const queryCountBeforeSelection = gpsHistoryMock.queries.length;
  const recordRow = screen.getAllByRole('row').find((candidate) => candidate.textContent.includes('ABC 234'));
  fireEvent.click(screen.getByRole('button', { name: 'Show point' }));
  const panel = screen.getByRole('region', { name: 'Historical GPS point' });
  const tableRegion = screen.getByRole('region', { name: 'Scrollable GPS history table' });
  const recordsSection = screen.getByRole('region', { name: 'GPS history records' });
  expect(recordRow).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'Show point' })).toHaveAttribute('aria-pressed', 'true');
  expect(panel).toBeVisible();
  expect(panel.compareDocumentPosition(recordsSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(tableRegion.contains(panel)).toBe(false);
  expect(screen.getByText('Historical · not live')).toBeInTheDocument();
  expect(screen.getByTestId('historical-map')).toBeInTheDocument();
  expect(screen.getByText('14.095')).toBeInTheDocument();
  expect(screen.getByText('121.16')).toBeInTheDocument();
  expect(screen.getByText('35 km/h')).toBeInTheDocument();
  expect(screen.getAllByText('GOOD')).toHaveLength(2);
  expect(screen.getByText('ON ROUTE')).toBeInTheDocument();
  expect(screen.getByText(/Captured .* PHT/)).toBeInTheDocument();
  expect(screen.getByTestId('historical-map-frame')).toHaveClass('h-[260px]', 'sm:h-[320px]');
  expect(screen.getByTestId('historical-map')).toHaveStyle({ width: '100%', height: '100%' });
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  expect(gpsHistoryMock.queries).toHaveLength(queryCountBeforeSelection);
  expect(leafletMock.mounts).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close historical map' }));
  expect(screen.queryByRole('region', { name: 'Historical GPS point' })).not.toBeInTheDocument();
  await waitFor(() => expect(leafletMock.unmounts).toBe(1));
});

test('a no-location historical sample can be selected without plotting fake coordinates', async () => {
  gpsHistoryMock.rows = [row('no-location', { latitude: null, longitude: null })];
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('ABC 234');
  fireEvent.click(screen.getByRole('button', { name: 'Select record' }));
  const panel = screen.getByRole('region', { name: 'Historical GPS point' });
  expect(within(panel).getByText('Historical point unavailable')).toBeInTheDocument();
  expect(within(panel).getByText(/Captured .* PHT/)).toBeInTheDocument();
  expect(within(panel).getAllByText('Unavailable')).toHaveLength(2);
  expect(within(panel).getByText('ON ROUTE')).toBeInTheDocument();
  expect(screen.queryByText(/Current location|Live GPS|interpolated/i)).not.toBeInTheDocument();
  expect(screen.queryByTestId('historical-map')).not.toBeInTheDocument();
});

test('selecting another historical row updates the same map instance and stored values', async () => {
  gpsHistoryMock.rows = [
    row('first', { latitude: 14.0951, longitude: 121.1601 }),
    row('second', { latitude: 14.0962, longitude: 121.1612 }),
  ];
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findAllByRole('button', { name: 'Show point' });
  const firstButton = screen.getAllByRole('button', { name: 'Show point' })[0];
  const firstRow = firstButton.closest('tr');
  fireEvent.click(firstButton);
  expect(await screen.findByText('14.0951')).toBeInTheDocument();
  expect(firstRow).toHaveAttribute('aria-selected', 'true');
  expect(leafletMock.map.setView).toHaveBeenLastCalledWith([14.0951, 121.1601], 14, { animate: false });

  const secondButton = screen.getAllByRole('button', { name: 'Show point' })[1];
  const secondRow = secondButton.closest('tr');
  fireEvent.click(within(secondRow).getByRole('button', { name: 'Show point' }));
  expect(await screen.findByText('14.0962')).toBeInTheDocument();
  expect(screen.getByText('121.1612')).toBeInTheDocument();
  expect(secondRow).toHaveAttribute('aria-selected', 'true');
  expect(firstRow).toHaveAttribute('aria-selected', 'false');
  expect(screen.getAllByTestId('historical-map')).toHaveLength(1);
  expect(leafletMock.mounts).toBe(1);
  expect(leafletMock.map.setView).toHaveBeenLastCalledWith([14.0962, 121.1612], 14, { animate: false });
});

test('explicit selection uses immediate scrolling when reduced motion is preferred', async () => {
  window.matchMedia = jest.fn(() => ({ matches: true }));
  gpsHistoryMock.rows = [row()];
  render(<GpsHistoryExplorer buses={[bus]} />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Show point' }))[0]);
  expect(await screen.findByRole('region', { name: 'Historical GPS point' })).toBeVisible();
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest' });
});

test('changing page clears a selected historical panel and its Leaflet map', async () => {
  gpsHistoryMock.rows = Array.from({ length: 51 }, (_, index) => row(String(51 - index)));
  gpsHistoryMock.count = 51;
  render(<GpsHistoryExplorer buses={[bus]} />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Show point' }))[0]);
  expect(await screen.findByRole('region', { name: 'Historical GPS point' })).toBeVisible();
  expect(leafletMock.mounts).toBe(1);

  fireEvent.click(screen.getByRole('button', { name: 'Next GPS history page' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Historical GPS point' })).not.toBeInTheDocument());
  await waitFor(() => expect(leafletMock.unmounts).toBe(1));
});

test('unmounting Records while a point map is open cleans up the map container', async () => {
  gpsHistoryMock.rows = [row()];
  const { unmount } = render(<GpsHistoryExplorer buses={[bus]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Show point' }));
  expect(await screen.findByRole('region', { name: 'Historical GPS point' })).toBeVisible();
  expect(leafletMock.mounts).toBe(1);
  unmount();
  expect(leafletMock.unmounts).toBe(1);
});

test('Raw and Operational rows both open the same historical panel without another data request', async () => {
  gpsHistoryMock.rows = [row()];
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('ABC 234');
  fireEvent.click(screen.getByRole('tab', { name: 'Raw GPS Records' }));
  expect(screen.getByRole('columnheader', { name: 'captured_at · PHT' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'created_at' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'source_record_id' })).toBeInTheDocument();
  expect(screen.getByText('source-1')).toBeInTheDocument();
  const queryCountBeforeSelection = gpsHistoryMock.queries.length;
  fireEvent.click(screen.getByRole('button', { name: 'Select point' }));
  expect(screen.getByRole('region', { name: 'Historical GPS point' })).toBeVisible();
  expect(gpsHistoryMock.queries).toHaveLength(queryCountBeforeSelection);
  expect(leafletMock.mounts).toBe(1);
});

test('custom invalid date range is explained and does not issue a database query', async () => {
  gpsHistoryMock.rows = [row()];
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('ABC 234');
  expect(gpsHistoryMock.queries).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Custom Range' }));
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-05' } });
  await waitFor(() => expect(gpsHistoryMock.queries).toHaveLength(2));
  const queryCountBeforeInvalidEndDate = gpsHistoryMock.queries.length;
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-04' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Start date must be on or before the end date.');
  expect(gpsHistoryMock.queries).toHaveLength(queryCountBeforeInvalidEndDate);
});

test('no-data and session-error states provide specific, actionable messages', async () => {
  const { unmount } = render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('No GPS records for this selection');
  unmount();

  gpsHistoryMock.error = { status: 401 };
  render(<GpsHistoryExplorer buses={[bus]} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Your sign-in session may have expired');
  expect(screen.getByRole('button', { name: 'Retry page' })).toBeInTheDocument();
});

test('numbered pagination loads a bounded later page directly and reuses cached prior rows and total', async () => {
  gpsHistoryMock.rows = Array.from({ length: 51 }, (_, index) => row(String(51 - index)));
  gpsHistoryMock.count = 51;
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('Showing 1–50 of 51 records');
  expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Previous GPS history page' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next GPS history page' })).toBeEnabled();
  expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next GPS history page' }));
  await screen.findByText('Showing 51–51 of 51 records');
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous GPS history page' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Next GPS history page' })).not.toBeInTheDocument();
  expect(gpsHistoryMock.queries[1].calls).toContainEqual(['range', 50, 99]);
  expect(gpsHistoryMock.countQueries).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Previous GPS history page' }));
  expect(await screen.findByText('Showing 1–50 of 51 records')).toBeInTheDocument();
  expect(gpsHistoryMock.queries).toHaveLength(2);
});

test('changing page size from a later page resets to page one, preserves filters, and reuses the cached total', async () => {
  window.sessionStorage.setItem('centrabus.gpsHistoryExplorer.filters', JSON.stringify({
    preset: 'custom',
    startDate: '2026-10-01',
    endDate: '2026-10-04',
    busId: 'bus-a',
    status: 'stopped',
    pageSize: 50,
  }));
  gpsHistoryMock.rows = Array.from({ length: 51 }, (_, index) => row(String(51 - index)));
  gpsHistoryMock.count = 51;
  render(<GpsHistoryExplorer buses={[bus]} />);

  await screen.findByText('Showing 1–50 of 51 records');
  fireEvent.click(screen.getByRole('button', { name: 'Next GPS history page' }));
  await screen.findByText('Showing 51–51 of 51 records');
  fireEvent.change(screen.getByLabelText('Records per page'), { target: { value: '25' } });

  expect(await screen.findByText('Showing 1–25 of 51 records')).toBeInTheDocument();
  expect(gpsHistoryMock.queries).toHaveLength(3);
  const resetQuery = gpsHistoryMock.queries[2].calls;
  expect(resetQuery).toContainEqual(['eq', 'bus_id', 'bus-a']);
  expect(resetQuery).toContainEqual(['eq', 'diagnostics->>motion_status', 'STOPPED']);
  expect(resetQuery).toContainEqual(['gte', 'captured_at', '2026-09-30T16:00:00.000Z']);
  expect(resetQuery).toContainEqual(['lt', 'captured_at', '2026-10-04T16:00:00.000Z']);
  expect(resetQuery).toContainEqual(['range', 0, 24]);
  expect(resetQuery.some(([method]) => method === 'or' || method === 'count')).toBe(false);
  expect(gpsHistoryMock.countQueries).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Previous GPS history page' })).not.toBeInTheDocument();
});

test('a direct page jump from page 1 to page 8 makes one bounded read and does not repeat count', async () => {
  gpsHistoryMock.rows = Array.from({ length: 1284 }, (_, index) => row(String(1284 - index)));
  gpsHistoryMock.count = 1284;
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('Showing 1–50 of 1,284 records');

  fireEvent.change(screen.getByLabelText('Go to GPS history page'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Go', exact: true }));

  expect(await screen.findByText('Showing 351–400 of 1,284 records')).toBeInTheDocument();
  expect(gpsHistoryMock.queries).toHaveLength(2);
  expect(gpsHistoryMock.queries[1].calls).toContainEqual(['range', 350, 399]);
  expect(gpsHistoryMock.countQueries).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Go to GPS history page 8' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('Page 8 of 26')).toBeInTheDocument();
});

test('middle and partial last pages show exact operator-facing footer ranges', async () => {
  window.sessionStorage.setItem('centrabus.gpsHistoryExplorer.filters', JSON.stringify({ pageSize: 100 }));
  gpsHistoryMock.rows = Array.from({ length: 1284 }, (_, index) => row(String(1284 - index)));
  gpsHistoryMock.count = 1284;
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('Showing 1–100 of 1,284 records');

  fireEvent.change(screen.getByLabelText('Go to GPS history page'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Go', exact: true }));
  expect(await screen.findByText('Showing 401–500 of 1,284 records')).toBeInTheDocument();
  expect(gpsHistoryMock.queries[1].calls).toContainEqual(['range', 400, 499]);

  fireEvent.change(screen.getByLabelText('Go to GPS history page'), { target: { value: '13' } });
  fireEvent.click(screen.getByRole('button', { name: 'Go', exact: true }));
  expect(await screen.findByText('Showing 1,201–1,284 of 1,284 records')).toBeInTheDocument();
  expect(gpsHistoryMock.queries[2].calls).toContainEqual(['range', 1200, 1299]);
  expect(gpsHistoryMock.countQueries).toHaveLength(1);
});

test('refresh explicitly rereads the active page and exact count', async () => {
  gpsHistoryMock.rows = [row()];
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('Showing 1–1 of 1 records');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => {
    expect(gpsHistoryMock.queries).toHaveLength(2);
    expect(gpsHistoryMock.countQueries).toHaveLength(2);
  });
});

test('count failures do not show an old or fabricated total and can be retried', async () => {
  gpsHistoryMock.rows = [row()];
  gpsHistoryMock.countError = { status: 503 };
  render(<GpsHistoryExplorer buses={[bus]} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Exact matching total is unavailable');
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.getByText('Page ready · matching total unavailable')).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'GPS history page navigation' })).not.toBeInTheDocument();

  gpsHistoryMock.countError = null;
  gpsHistoryMock.count = 1;
  fireEvent.click(screen.getByRole('button', { name: 'Retry total' }));
  expect(await screen.findByText('Showing 1–1 of 1 records')).toBeInTheDocument();
  expect(gpsHistoryMock.countQueries).toHaveLength(2);
});

test('filter toolbar wraps responsively and horizontal overflow is contained in the table region', async () => {
  render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('No GPS records for this selection');
  const tableRegion = screen.getByRole('region', { name: 'Scrollable GPS history table' });
  expect(tableRegion.className).toContain('overflow-auto');
  expect(screen.getByLabelText('Quick date filters')).toHaveClass('flex-wrap');
  expect(screen.getByLabelText('Filter by bus')).toBeVisible();
});

test('bus, custom range, view mode, and page size survive same-session unmount/remount', async () => {
  const { unmount } = render(<GpsHistoryExplorer buses={[bus]} />);
  await screen.findByText('No GPS records for this selection');
  fireEvent.click(screen.getByRole('button', { name: 'Custom Range' }));
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-02' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-04' } });
  fireEvent.change(screen.getByLabelText('Filter by bus'), { target: { value: 'bus-a' } });
  fireEvent.change(screen.getByLabelText('Records per page'), { target: { value: '25' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Raw GPS Records' }));
  await waitFor(() => expect(gpsHistoryMock.queries.length).toBeGreaterThanOrEqual(2));
  unmount();

  render(<GpsHistoryExplorer buses={[bus]} />);
  expect(screen.getByRole('button', { name: 'Custom Range' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Start date')).toHaveValue('2026-10-02');
  expect(screen.getByLabelText('End date')).toHaveValue('2026-10-04');
  expect(screen.getByLabelText('Filter by bus')).toHaveValue('bus-a');
  expect(screen.getByLabelText('Records per page')).toHaveValue('25');
  expect(screen.getByRole('tab', { name: 'Raw GPS Records' })).toHaveAttribute('aria-selected', 'true');
  await screen.findByText('No GPS records for this selection');
});
