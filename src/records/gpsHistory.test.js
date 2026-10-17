import {
  buildGpsHistoryCsv,
  fetchGpsHistoryCount,
  fetchGpsHistoryPage,
  formatGpsHistoryPeriod,
  getGpsHistoryBusLabel,
  getGpsHistoryPageNumbers,
  getGpsHistoryPageRange,
  getGpsHistoryTotalPages,
  getPhilippineCalendarDate,
  normalizeGpsHistoryPageSize,
  normalizeGpsHistoryRow,
  resolveGpsHistoryDateRange,
} from './gpsHistory';

function createQueryResult({ data = [], count = 0, error = null } = {}) {
  const calls = [];
  const query = {};
  ['select', 'gte', 'lt', 'eq', 'in', 'order', 'range'].forEach((method) => {
    query[method] = jest.fn((...args) => {
      calls.push([method, ...args]);
      return query;
    });
  });
  query.then = (resolve, reject) => {
    const selection = calls.find(([method]) => method === 'select');
    const range = calls.find(([method]) => method === 'range');
    const isHeadCount = selection?.[2]?.head === true;
    const pageData = range ? data.slice(range[1], range[2] + 1) : data;
    return Promise.resolve({ data: isHeadCount ? null : pageData, count, error }).then(resolve, reject);
  };
  return { query, calls };
}

function createSupabase(data = [], count = data.length) {
  const result = createQueryResult({ data, count });
  const supabase = { from: jest.fn(() => result.query) };
  return { supabase, ...result };
}

const phtAfternoon = Date.parse('2026-10-03T16:30:00.000Z');

test('Philippine day boundaries use the full PHT calendar day as a half-open UTC interval', () => {
  expect(getPhilippineCalendarDate(phtAfternoon)).toBe('2026-10-04');
  const range = resolveGpsHistoryDateRange({ preset: 'today' }, phtAfternoon);
  expect(range).toMatchObject({
    valid: true,
    startDate: '2026-10-04',
    endDate: '2026-10-04',
    startAt: '2026-10-03T16:00:00.000Z',
    endAt: '2026-10-04T16:00:00.000Z',
  });
});

test('Today and Yesterday follow Philippine midnight, including UTC day rollover', () => {
  const now = Date.parse('2026-10-03T17:15:00.000Z');
  expect(resolveGpsHistoryDateRange({ preset: 'today' }, now).startDate).toBe('2026-10-04');
  expect(resolveGpsHistoryDateRange({ preset: 'yesterday' }, now)).toMatchObject({
    startDate: '2026-10-03',
    endDate: '2026-10-03',
    startAt: '2026-10-02T16:00:00.000Z',
    endAt: '2026-10-03T16:00:00.000Z',
  });
});

test('Last 7 Days means today and the previous six Philippine calendar days', () => {
  expect(resolveGpsHistoryDateRange({ preset: 'last7Days' }, phtAfternoon)).toMatchObject({
    startDate: '2026-09-28',
    endDate: '2026-10-04',
    startAt: '2026-09-27T16:00:00.000Z',
    endAt: '2026-10-04T16:00:00.000Z',
  });
});

test('custom single-day and multi-day ranges include the selected Philippine end date', () => {
  expect(resolveGpsHistoryDateRange({
    preset: 'custom', startDate: '2026-10-04', endDate: '2026-10-04',
  })).toMatchObject({ startAt: '2026-10-03T16:00:00.000Z', endAt: '2026-10-04T16:00:00.000Z' });
  expect(resolveGpsHistoryDateRange({
    preset: 'custom', startDate: '2026-10-02', endDate: '2026-10-04',
  })).toMatchObject({ startAt: '2026-10-01T16:00:00.000Z', endAt: '2026-10-04T16:00:00.000Z' });
});

test('capture-period labels use readable Philippine dates for single, same-year, and cross-year ranges', () => {
  expect(formatGpsHistoryPeriod('2026-10-04', '2026-10-04')).toBe('Oct 4, 2026');
  expect(formatGpsHistoryPeriod('2026-09-28', '2026-10-04')).toBe('Sep 28 – Oct 4, 2026');
  expect(formatGpsHistoryPeriod('2026-12-28', '2027-01-04')).toBe('Dec 28, 2026 – Jan 4, 2027');
  expect(formatGpsHistoryPeriod('2026-10-05', '2026-10-04')).toBe('Invalid date range');
});

test('custom range rejects invalid calendar dates and start dates after end dates', () => {
  expect(resolveGpsHistoryDateRange({ preset: 'custom', startDate: '2026-02-30', endDate: '2026-03-01' }).valid).toBe(false);
  expect(resolveGpsHistoryDateRange({ preset: 'custom', startDate: '2026-10-05', endDate: '2026-10-04' })).toMatchObject({
    valid: false,
    error: 'Start date must be on or before the end date.',
  });
});

test('GPS history page size defaults to 50 and only allows bounded options', () => {
  expect(normalizeGpsHistoryPageSize(undefined)).toBe(50);
  expect(normalizeGpsHistoryPageSize(25)).toBe(25);
  expect(normalizeGpsHistoryPageSize(100)).toBe(100);
  expect(normalizeGpsHistoryPageSize(1000)).toBe(50);
});

test('history query applies captured_at half-open bounds, selected bus, deterministic sort, and bounded page range', async () => {
  const { supabase, calls } = createSupabase();
  await fetchGpsHistoryPage(supabase, {
    startAt: '2026-10-03T16:00:00.000Z',
    endAt: '2026-10-04T16:00:00.000Z',
    busId: 'bus-a',
    pageSize: 50,
  });

  expect(supabase.from).toHaveBeenCalledWith('gps_history');
  expect(calls).toContainEqual(['gte', 'captured_at', '2026-10-03T16:00:00.000Z']);
  expect(calls).toContainEqual(['lt', 'captured_at', '2026-10-04T16:00:00.000Z']);
  expect(calls).toContainEqual(['eq', 'bus_id', 'bus-a']);
  expect(calls).toContainEqual(['order', 'captured_at', { ascending: false }]);
  expect(calls).toContainEqual(['order', 'id', { ascending: false }]);
  expect(calls).toContainEqual(['range', 0, 49]);
  expect(calls.find(([method]) => method === 'select')[1]).toContain('captured_at');
});

test('All buses omits a bus predicate while status filters remain server-side', async () => {
  const { supabase, calls } = createSupabase();
  await fetchGpsHistoryPage(supabase, {
    startAt: '2026-10-03T16:00:00.000Z',
    endAt: '2026-10-04T16:00:00.000Z',
    busId: 'all',
    status: 'weakGps',
  });
  expect(calls.some(([method, column]) => method === 'eq' && column === 'bus_id')).toBe(false);
  expect(calls).toContainEqual(['eq', 'diagnostics->>gps_quality', 'WEAK']);
  expect(calls).toContainEqual(['range', 0, 49]);
});

test('numbered query jumps directly to one bounded range without fetching preceding pages', async () => {
  const { supabase, calls } = createSupabase();
  await fetchGpsHistoryPage(supabase, {
    startAt: '2026-10-03T16:00:00.000Z',
    endAt: '2026-10-04T16:00:00.000Z',
    pageSize: 50,
    pageNumber: 8,
  });
  expect(calls).toContainEqual(['range', 350, 399]);
  expect(calls.filter(([method]) => method === 'range')).toHaveLength(1);
  expect(calls.some(([method]) => method === 'limit' || method === 'or')).toBe(false);
});

test('query returns only the requested bounded page', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: String(51 - index),
    bus_id: 'bus-a',
    captured_at: new Date(Date.UTC(2026, 9, 4, 0, 0, index)).toISOString(),
    latitude: 14.1,
    longitude: 121.1,
  }));
  const { supabase } = createSupabase(rows);
  const result = await fetchGpsHistoryPage(supabase, {
    startAt: '2026-10-03T16:00:00.000Z',
    endAt: '2026-10-04T16:00:00.000Z',
    pageSize: 50,
  });
  expect(result.rows).toHaveLength(50);
  expect(result.fetchedCount).toBe(50);
});

test('query rejects invalid bounds, page numbers, and unsupported statuses without an unbounded read', async () => {
  const { supabase } = createSupabase();
  await expect(fetchGpsHistoryPage(supabase, { startAt: 'bad', endAt: 'also-bad' })).rejects.toThrow(/valid GPS capture-time range/);
  await expect(fetchGpsHistoryPage(supabase, {
    startAt: '2026-10-03T16:00:00.000Z', endAt: '2026-10-04T16:00:00.000Z', status: 'invented',
  })).rejects.toThrow(/Unsupported GPS history status filter/);
  await expect(fetchGpsHistoryPage(supabase, {
    startAt: '2026-10-03T16:00:00.000Z', endAt: '2026-10-04T16:00:00.000Z', pageNumber: 0,
  })).rejects.toThrow(/positive integer/);
  expect(supabase.from).not.toHaveBeenCalled();
});

test('exact count is metadata-only and applies the same date, bus, and status filters', async () => {
  const { supabase, calls } = createSupabase([], 1284);
  const count = await fetchGpsHistoryCount(supabase, {
    startAt: '2026-10-03T16:00:00.000Z',
    endAt: '2026-10-04T16:00:00.000Z',
    busId: 'bus-a',
    status: 'stopped',
  });
  expect(count).toBe(1284);
  expect(calls).toContainEqual(['select', 'id', { count: 'exact', head: true }]);
  expect(calls).toContainEqual(['gte', 'captured_at', '2026-10-03T16:00:00.000Z']);
  expect(calls).toContainEqual(['lt', 'captured_at', '2026-10-04T16:00:00.000Z']);
  expect(calls).toContainEqual(['eq', 'bus_id', 'bus-a']);
  expect(calls).toContainEqual(['eq', 'diagnostics->>motion_status', 'STOPPED']);
  expect(calls.some(([method]) => method === 'range' || method === 'order')).toBe(false);
});

test('exact count supports all buses and rejects missing or invalid metadata safely', async () => {
  const { supabase, calls } = createSupabase([], 8);
  await expect(fetchGpsHistoryCount(supabase, {
    startAt: '2026-10-03T16:00:00.000Z', endAt: '2026-10-04T16:00:00.000Z', busId: 'all', status: 'weakGps',
  })).resolves.toBe(8);
  expect(calls.some(([method, column]) => method === 'eq' && column === 'bus_id')).toBe(false);
  expect(calls).toContainEqual(['eq', 'diagnostics->>gps_quality', 'WEAK']);

  const missingCount = createSupabase([], null).supabase;
  await expect(fetchGpsHistoryCount(missingCount, {
    startAt: '2026-10-03T16:00:00.000Z', endAt: '2026-10-04T16:00:00.000Z',
  })).rejects.toThrow(/exact GPS history count was not returned/);
});

test.each([
  [25, 52],
  [50, 26],
  [100, 13],
])('total page count for 1,284 records at page size %i is %i', (pageSize, totalPages) => {
  expect(getGpsHistoryTotalPages(1284, pageSize)).toBe(totalPages);
});

test('page range supports first, middle, and partial last pages', () => {
  expect(getGpsHistoryPageRange(1284, 1, 100)).toEqual({ from: 1, to: 100 });
  expect(getGpsHistoryPageRange(1284, 5, 100)).toEqual({ from: 401, to: 500 });
  expect(getGpsHistoryPageRange(1284, 13, 100)).toEqual({ from: 1201, to: 1284 });
  expect(getGpsHistoryPageRange(8, 1, 100)).toEqual({ from: 1, to: 8 });
});

test('numbered page controls remain compact and place ellipses around distant pages', () => {
  expect(getGpsHistoryPageNumbers(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(getGpsHistoryPageNumbers(1, 13)).toEqual([1, 2, 3, 4, 5, 'ellipsis-end', 13]);
  expect(getGpsHistoryPageNumbers(8, 13)).toEqual([1, 'ellipsis-start', 6, 7, 8, 9, 10, 'ellipsis-end', 13]);
  expect(getGpsHistoryPageNumbers(13, 13)).toEqual([1, 'ellipsis-start', 9, 10, 11, 12, 13]);
  expect(getGpsHistoryPageNumbers(1, 100)).toHaveLength(7);
});

test('history row normalization keeps capture time distinct from database insert time and rejects invalid map coordinates', () => {
  const row = normalizeGpsHistoryRow({
    id: 8,
    bus_id: 'bus-a',
    captured_at: '2026-10-04T01:00:00.000Z',
    created_at: '2026-10-04T01:00:03.000Z',
    latitude: '14.095',
    longitude: '181',
    speed: '12.5',
    route_status: 'ON ROUTE',
    diagnostics: { raw_speed_kmh: '12.5', movement_2s_m: 5, gps_quality: 'GOOD', motion_status: 'MOVING', horizontal_accuracy_m: '4.2' },
  });
  expect(row).toMatchObject({
    capturedAt: '2026-10-04T01:00:00.000Z',
    createdAt: '2026-10-04T01:00:03.000Z',
    latitude: 14.095,
    longitude: 181,
    speed: 12.5,
    gpsQuality: 'GOOD',
    motionStatus: 'MOVING',
    horizontalAccuracyM: 4.2,
  });
  expect(Number.isFinite(Date.parse(row.capturedAt))).toBe(true);
  expect(normalizeGpsHistoryRow({ latitude: 'NaN', longitude: null })).toMatchObject({ latitude: null, longitude: null });
});

test('GPS history CSV contains stored values and operator-facing bus labels without derived coordinates', () => {
  const csv = buildGpsHistoryCsv([{
    id: 4,
    sourceRecordId: 'sample-4',
    busId: 'bus-a',
    deviceId: 'GPS-001',
    capturedAt: '2026-10-04T01:00:00.000Z',
    createdAt: '2026-10-04T01:00:02.000Z',
    latitude: 14.095,
    longitude: 121.16,
    speed: 35,
    motionStatus: 'MOVING',
  }], [{ id: 'bus-a', plateNumber: 'ABC 234' }]);
  expect(csv).toContain('Plate / Fleet Label');
  expect(csv).toContain('captured_at');
  expect(csv).toContain('"ABC 234","4","sample-4","bus-a","GPS-001"');
  expect(csv).toContain('"14.095","121.16","","","35"');
  expect(csv).not.toContain('interpolated');
  expect(getGpsHistoryBusLabel({ id: 'bus-b', busCode: 'BUS 02' }, 1)).toBe('BUS 02');
});
