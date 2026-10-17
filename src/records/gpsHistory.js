import { rawGpsSpeed, rawGpsMotion } from '../gpsMotion';

export const GPS_HISTORY_PAGE_SIZE_DEFAULT = 50;
export const GPS_HISTORY_PAGE_SIZE_OPTIONS = [25, 50, 100];
export const GPS_HISTORY_MAX_PAGE_SIZE = 100;
export const GPS_HISTORY_ALL_BUSES = 'all';
export const GPS_HISTORY_TIME_ZONE = 'Asia/Manila';

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const GPS_HISTORY_COLUMNS = [
  'id',
  'source_record_id',
  'bus_id',
  'device_id',
  'latitude',
  'longitude',
  'live_latitude',
  'live_longitude',
  'speed',
  'captured_at',
  'created_at',
  'route_status',
  'distance_from_route_m',
  'diagnostics',
].join(',');

export const GPS_HISTORY_STATUS_FILTERS = {
  all: { label: 'All statuses' },
  moving: { label: 'Moving', column: 'diagnostics->>motion_status', operator: 'eq', value: 'MOVING' },
  stopped: { label: 'Stopped', column: 'diagnostics->>motion_status', operator: 'eq', value: 'STOPPED' },
  onRoute: { label: 'On route', column: 'route_status', operator: 'eq', value: 'ON ROUTE' },
  possibleDeviation: { label: 'Possible deviation', column: 'route_status', operator: 'eq', value: 'POSSIBLE DEVIATION' },
  confirmedDeviation: { label: 'Confirmed deviation', column: 'route_status', operator: 'eq', value: 'CONFIRMED DEVIATION' },
  goodGps: { label: 'GPS quality: good', column: 'diagnostics->>gps_quality', operator: 'eq', value: 'GOOD' },
  weakGps: { label: 'GPS quality: weak', column: 'diagnostics->>gps_quality', operator: 'eq', value: 'WEAK' },
};

function parseCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function formatCalendarDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getPhilippineCalendarDate(now = Date.now()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: GPS_HISTORY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return formatCalendarDate(Number(values.year), Number(values.month), Number(values.day));
}

export function addCalendarDays(calendarDate, amount) {
  const parts = parseCalendarDate(calendarDate);
  if (!parts || !Number.isInteger(amount)) return '';
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return formatCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function phtMidnightToUtcIso(calendarDate) {
  const parts = parseCalendarDate(calendarDate);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - PHT_OFFSET_MS).toISOString();
}

function formatPhtCalendarDate(parts, includeYear = true) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: GPS_HISTORY_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
  }).format(date);
}

export function formatGpsHistoryPeriod(startDate, endDate) {
  const start = parseCalendarDate(startDate);
  const end = parseCalendarDate(endDate);
  if (!start || !end || startDate > endDate) return 'Invalid date range';

  const startLabel = formatPhtCalendarDate(start, start.year !== end.year);
  const endLabel = formatPhtCalendarDate(end);
  return startDate === endDate ? endLabel : `${startLabel} – ${endLabel}`;
}

export function resolveGpsHistoryDateRange(filters = {}, now = Date.now()) {
  const today = getPhilippineCalendarDate(now);
  const preset = filters.preset || 'today';
  let startDate = filters.startDate || today;
  let endDate = filters.endDate || today;

  if (preset === 'today') {
    startDate = today;
    endDate = today;
  } else if (preset === 'yesterday') {
    startDate = addCalendarDays(today, -1);
    endDate = startDate;
  } else if (preset === 'last7Days') {
    startDate = addCalendarDays(today, -6);
    endDate = today;
  } else if (preset !== 'custom') {
    return { valid: false, error: 'Choose a supported date range.' };
  }

  if (!parseCalendarDate(startDate) || !parseCalendarDate(endDate)) {
    return { valid: false, error: 'Enter a valid start date and end date.' };
  }
  if (startDate > endDate) {
    return { valid: false, error: 'Start date must be on or before the end date.' };
  }

  const nextDate = addCalendarDays(endDate, 1);
  return {
    valid: true,
    preset,
    startDate,
    endDate,
    startAt: phtMidnightToUtcIso(startDate),
    endAt: phtMidnightToUtcIso(nextDate),
  };
}

export function formatGpsHistoryTimestamp(timestamp, options = {}) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: GPS_HISTORY_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(options.seconds ? { second: '2-digit' } : {}),
  }).format(date);
}

export function getGpsHistoryDateGroup(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: GPS_HISTORY_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function normalizeGpsHistoryPageSize(value) {
  const pageSize = Number(value);
  return [25, 50, 100].includes(pageSize) ? pageSize : GPS_HISTORY_PAGE_SIZE_DEFAULT;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeGpsHistoryRow(row = {}) {
  const diagnostics = row.diagnostics && typeof row.diagnostics === 'object' && !Array.isArray(row.diagnostics)
    ? row.diagnostics
    : {};
  const evidence = {
    rawSpeedKmh: diagnostics.raw_speed_kmh ?? diagnostics.rawSpeedKmh,
    gpsQuality: diagnostics.gps_quality ?? diagnostics.gpsQuality,
    horizontalAccuracyM: diagnostics.horizontal_accuracy_m ?? diagnostics.horizontalAccuracyM,
    movement2sM: diagnostics.movement_2s_m ?? diagnostics.movement2sM,
    movement4sM: diagnostics.movement_4s_m ?? diagnostics.movement4sM,
    movement6sM: diagnostics.movement_6s_m ?? diagnostics.movement6sM,
  };
  return {
    id: row.id ?? null,
    sourceRecordId: row.source_record_id ?? null,
    busId: row.bus_id ?? '',
    deviceId: row.device_id ?? '',
    capturedAt: row.captured_at ?? null,
    capturedAtMs: Date.parse(row.captured_at),
    createdAt: row.created_at ?? null,
    latitude: finiteNumberOrNull(row.latitude),
    longitude: finiteNumberOrNull(row.longitude),
    liveLatitude: finiteNumberOrNull(row.live_latitude),
    liveLongitude: finiteNumberOrNull(row.live_longitude),
    speed: rawGpsSpeed(evidence),
    routeStatus: row.route_status ?? '',
    distanceFromRouteM: finiteNumberOrNull(row.distance_from_route_m),
    rawSpeedKmh: finiteNumberOrNull(diagnostics.raw_speed_kmh ?? diagnostics.rawSpeedKmh),
    motionStatus: rawGpsMotion(evidence),
    filterState: diagnostics.filter_state ?? diagnostics.filterState ?? '',
    gpsQuality: diagnostics.gps_quality ?? diagnostics.gpsQuality ?? '',
    horizontalAccuracyM: finiteNumberOrNull(diagnostics.horizontal_accuracy_m ?? diagnostics.horizontalAccuracyM),
    consistency: diagnostics.consistency ?? '',
    satellitesUsed: finiteNumberOrNull(diagnostics.satellites_used ?? diagnostics.satellitesUsed),
  };
}

export function hasGpsHistoryCoordinates(record = {}) {
  return Number.isFinite(record.latitude)
    && record.latitude >= -90
    && record.latitude <= 90
    && Number.isFinite(record.longitude)
    && record.longitude >= -180
    && record.longitude <= 180;
}

function validateGpsHistoryFilters({ startAt, endAt, status = 'all' } = {}) {
  if (!startAt || !endAt || !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)) || Date.parse(startAt) >= Date.parse(endAt)) {
    throw new RangeError('A valid GPS capture-time range is required.');
  }
  if (!Object.prototype.hasOwnProperty.call(GPS_HISTORY_STATUS_FILTERS, status)) {
    throw new RangeError('Unsupported GPS history status filter.');
  }
}

function applyGpsHistoryFilters(query, { startAt, endAt, busId = GPS_HISTORY_ALL_BUSES, status = 'all' }) {
  let filteredQuery = query.gte('captured_at', startAt).lt('captured_at', endAt);
  if (busId && busId !== GPS_HISTORY_ALL_BUSES) filteredQuery = filteredQuery.eq('bus_id', busId);

  const statusFilter = GPS_HISTORY_STATUS_FILTERS[status];
  if (statusFilter.column && statusFilter.operator === 'eq') {
    filteredQuery = filteredQuery.eq(statusFilter.column, statusFilter.value);
  }
  if (statusFilter.column && statusFilter.operator === 'in') {
    filteredQuery = filteredQuery.in(statusFilter.column, statusFilter.value);
  }
  return filteredQuery;
}

export function fetchGpsHistoryCount(supabase, filters = {}) {
  try {
    validateGpsHistoryFilters(filters);
  } catch (error) {
    return Promise.reject(error);
  }

  const query = applyGpsHistoryFilters(
    supabase.from('gps_history').select('id', { count: 'exact', head: true }),
    filters,
  );

  return Promise.resolve(query).then(({ count, error }) => {
    if (error) throw error;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('The exact GPS history count was not returned.');
    }
    return count;
  });
}

export function fetchGpsHistoryPage(supabase, {
  startAt,
  endAt,
  busId = GPS_HISTORY_ALL_BUSES,
  status = 'all',
  pageSize = GPS_HISTORY_PAGE_SIZE_DEFAULT,
  pageNumber = 1,
} = {}) {
  const normalizedPageSize = normalizeGpsHistoryPageSize(pageSize);
  const normalizedPageNumber = Number(pageNumber);
  if (!Number.isSafeInteger(normalizedPageNumber) || normalizedPageNumber < 1) {
    return Promise.reject(new RangeError('GPS history page number must be a positive integer.'));
  }
  const rangeStart = (normalizedPageNumber - 1) * normalizedPageSize;
  if (!Number.isSafeInteger(rangeStart)) {
    return Promise.reject(new RangeError('GPS history page is outside the supported range.'));
  }
  try {
    validateGpsHistoryFilters({ startAt, endAt, status });
  } catch (error) {
    return Promise.reject(error);
  }

  let query = supabase
    .from('gps_history')
    .select(GPS_HISTORY_COLUMNS);
  query = applyGpsHistoryFilters(query, { startAt, endAt, busId, status });

  query = query
    .order('captured_at', { ascending: false })
    .order('id', { ascending: false })
    .range(rangeStart, rangeStart + normalizedPageSize - 1);

  return Promise.resolve(query).then(({ data, error }) => {
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []).map(normalizeGpsHistoryRow);
    return {
      rows,
      fetchedCount: rows.length,
    };
  });
}

export function getGpsHistoryTotalPages(totalCount, pageSize) {
  const count = Number(totalCount);
  if (!Number.isSafeInteger(count) || count < 0) return 0;
  return Math.ceil(count / normalizeGpsHistoryPageSize(pageSize));
}

export function getGpsHistoryPageRange(totalCount, pageNumber, pageSize) {
  const count = Number(totalCount);
  const page = Number(pageNumber);
  const size = normalizeGpsHistoryPageSize(pageSize);
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(page) || page < 1 || count === 0) {
    return { from: 0, to: 0 };
  }
  const offset = (page - 1) * size;
  if (!Number.isSafeInteger(offset) || offset >= count) return { from: 0, to: 0 };
  return { from: offset + 1, to: Math.min(offset + size, count) };
}

export function getGpsHistoryPageNumbers(currentPage, totalPages) {
  const total = Number(totalPages);
  const current = Number(currentPage);
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(current) || current < 1) return [];
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const page = Math.min(current, total);
  if (page <= 4) return [1, 2, 3, 4, 5, 'ellipsis-end', total];
  if (page >= total - 3) return [1, 'ellipsis-start', total - 4, total - 3, total - 2, total - 1, total];
  return [1, 'ellipsis-start', page - 2, page - 1, page, page + 1, page + 2, 'ellipsis-end', total];
}

export function getGpsHistoryBusLabel(bus, index = 0, deviceId = '') {
  if (!bus) return 'Unknown bus';
  const metadata = bus.metadata && typeof bus.metadata === 'object' ? bus.metadata : {};
  const preferred = [
    bus.plateNumber,
    bus.busCode,
    metadata.busCode,
    bus.deviceId,
    metadata.deviceId,
    deviceId,
    bus.fleetLabel,
    metadata.fleetLabel,
    bus.name,
    metadata.name,
  ]
    .find((value) => typeof value === 'string' && value.trim());
  return preferred ? preferred.trim() : `Fleet bus ${index + 1}`;
}

export function buildGpsHistoryCsv(records = [], buses = []) {
  const busById = new Map(buses.map((bus, index) => [bus.id, { bus, index }]));
  const fields = [
    ['id', 'Record ID'],
    ['sourceRecordId', 'Source Record ID'],
    ['busId', 'Bus ID'],
    ['deviceId', 'Device ID'],
    ['capturedAt', 'captured_at'],
    ['createdAt', 'created_at'],
    ['latitude', 'latitude'],
    ['longitude', 'longitude'],
    ['liveLatitude', 'live_latitude'],
    ['liveLongitude', 'live_longitude'],
    ['speed', 'speed'],
    ['routeStatus', 'route_status'],
    ['distanceFromRouteM', 'distance_from_route_m'],
    ['rawSpeedKmh', 'diagnostics.raw_speed_kmh'],
    ['motionStatus', 'diagnostics.motion_status'],
    ['filterState', 'diagnostics.filter_state'],
    ['gpsQuality', 'diagnostics.gps_quality'],
    ['horizontalAccuracyM', 'diagnostics.horizontal_accuracy_m'],
    ['consistency', 'diagnostics.consistency'],
    ['satellitesUsed', 'diagnostics.satellites_used'],
  ];
  const headings = ['Plate / Fleet Label', ...fields.map(([, heading]) => heading)];
  const quote = (value) => {
    const normalized = value && typeof value === 'object' ? JSON.stringify(value) : value;
    const safeValue = typeof normalized === 'string' && /^[=+@-]/.test(normalized)
      ? `'${normalized}`
      : normalized;
    return `"${String(safeValue ?? '').replace(/"/g, '""')}"`;
  };
  const rows = records.map((record) => {
    const busInfo = busById.get(record.busId);
    return [getGpsHistoryBusLabel(busInfo?.bus, busInfo?.index ?? 0, record.deviceId), ...fields.map(([key]) => record[key])];
  });
  return [headings, ...rows].map((row) => row.map(quote).join(',')).join('\r\n');
}
