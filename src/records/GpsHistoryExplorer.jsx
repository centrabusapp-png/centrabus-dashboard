import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, MapPin, RefreshCcw, X } from 'lucide-react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { supabase } from '../supabase';
import {
  buildGpsHistoryCsv,
  fetchGpsHistoryCount,
  fetchGpsHistoryPage,
  formatGpsHistoryPeriod,
  formatGpsHistoryTimestamp,
  getGpsHistoryBusLabel,
  getGpsHistoryDateGroup,
  getGpsHistoryPageNumbers,
  getGpsHistoryPageRange,
  getGpsHistoryTotalPages,
  hasGpsHistoryCoordinates,
  normalizeGpsHistoryPageSize,
  resolveGpsHistoryDateRange,
  GPS_HISTORY_ALL_BUSES,
  GPS_HISTORY_PAGE_SIZE_DEFAULT,
  GPS_HISTORY_PAGE_SIZE_OPTIONS,
  GPS_HISTORY_STATUS_FILTERS,
} from './gpsHistory';

const FILTER_STORAGE_KEY = 'centrabus.gpsHistoryExplorer.filters';

function readSavedFilters(initialBusId) {
  let saved = {};
  try {
    const serialized = window.sessionStorage.getItem(FILTER_STORAGE_KEY);
    saved = serialized ? JSON.parse(serialized) : {};
  } catch {
    saved = {};
  }

  const today = resolveGpsHistoryDateRange({ preset: 'today' }).startDate;
  const allowedPresets = ['today', 'yesterday', 'last7Days', 'custom'];
  const allowedStatuses = Object.keys(GPS_HISTORY_STATUS_FILTERS);
  const view = saved.view === 'raw' ? 'raw' : 'operational';
  return {
    preset: allowedPresets.includes(saved.preset) ? saved.preset : 'today',
    startDate: typeof saved.startDate === 'string' ? saved.startDate : today,
    endDate: typeof saved.endDate === 'string' ? saved.endDate : today,
    busId: initialBusId || (typeof saved.busId === 'string' ? saved.busId : GPS_HISTORY_ALL_BUSES),
    status: allowedStatuses.includes(saved.status) ? saved.status : 'all',
    pageSize: normalizeGpsHistoryPageSize(saved.pageSize || GPS_HISTORY_PAGE_SIZE_DEFAULT),
    view,
  };
}

function getHistoryErrorMessage(error) {
  const status = Number(error?.status);
  const code = String(error?.code || '');
  if (status === 401 || code === 'PGRST301' || code === 'JWT_EXPIRED') {
    return 'Your sign-in session may have expired. Sign in again to view GPS history.';
  }
  if (status === 403 || code === '42501') {
    return 'Your account is not permitted to read GPS history.';
  }
  return 'GPS history could not be loaded. Check your connection and try again.';
}

function getRecordKey(record, index) {
  return String(record.id ?? `${record.busId}-${record.capturedAt || 'unknown'}-${record.sourceRecordId || index}`);
}

function getBusOptionLabel(bus, index) {
  const label = getGpsHistoryBusLabel(bus, index);
  const alternate = bus.busCode && bus.busCode !== label
    ? bus.busCode
    : bus.deviceId && bus.deviceId !== label
      ? bus.deviceId
      : '';
  return alternate ? `${label} · ${alternate}` : label;
}

function TextStatus({ value, tone = 'neutral' }) {
  const colors = {
    neutral: 'border-slate-200 bg-slate-50 text-slate-700',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    critical: 'border-red-200 bg-red-50 text-red-800',
  };
  return <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-extrabold ${colors[tone] || colors.neutral}`}>{value || 'Unknown'}</span>;
}

function getMovementPresentation(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'MOVING') return { label: 'Moving', tone: 'good' };
  if (normalized === 'STOPPED') return { label: 'Stopped', tone: 'neutral' };
  return { label: 'Unknown', tone: 'neutral' };
}

function getRoutePresentation(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'ON ROUTE') return { label: 'On route', tone: 'good' };
  if (normalized === 'POSSIBLE DEVIATION') return { label: 'Possible deviation', tone: 'warning' };
  if (normalized === 'CONFIRMED DEVIATION') return { label: 'Confirmed deviation', tone: 'critical' };
  return { label: 'Unknown', tone: 'neutral' };
}

function HistoricalPointRecenter({ record }) {
  const map = useMap();
  useEffect(() => {
    if (hasGpsHistoryCoordinates(record)) {
      map.setView([record.latitude, record.longitude], Math.max(map.getZoom?.() || 14, 14), { animate: false });
    }
  }, [map, record.id, record.latitude, record.longitude]);
  return null;
}

export function HistoricalGpsPointMap({ record, busLabel, onClose, panelRef }) {
  const hasCoordinates = hasGpsHistoryCoordinates(record);
  const point = hasCoordinates ? [record.latitude, record.longitude] : null;

  return (
    <section ref={panelRef} aria-label="Historical GPS point" className="min-w-0 overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sky-100 bg-sky-50 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-extrabold text-slate-900">Historical GPS point</h2>
            <TextStatus value="Historical · not live" tone="warning" />
          </div>
          <p className="mt-1 break-words text-xs font-semibold text-slate-600">
            {busLabel} · Captured {formatGpsHistoryTimestamp(record.capturedAt)} PHT
          </p>
        </div>
        <button type="button" aria-label="Close historical map" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-sky-200 bg-white text-slate-600 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]">
          <X size={16} />
        </button>
      </div>
      {hasCoordinates ? (
        <div data-testid="historical-map-frame" className="h-[260px] w-full min-w-0 overflow-hidden sm:h-[320px]">
          <MapContainer center={point} zoom={14} scrollWheelZoom className="h-full w-full" style={{ width: '100%', height: '100%' }}>
            <TileLayer attribution='&copy; OpenStreetMap contributors' url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' />
            <HistoricalPointRecenter record={record} />
            <CircleMarker center={point} radius={9} pathOptions={{ color: '#8E1F2F', weight: 3, fillColor: '#F4A340', fillOpacity: 0.95 }}>
              <Tooltip permanent direction="top">Selected historical point</Tooltip>
            </CircleMarker>
          </MapContainer>
        </div>
      ) : (
        <div className="flex min-h-[150px] items-center justify-center px-5 py-8 text-center" role="status">
          <div>
            <MapPin size={20} className="mx-auto text-slate-400" aria-hidden="true" />
            <p className="mt-2 text-sm font-extrabold text-slate-800">Historical point unavailable</p>
            <p className="mt-1 text-xs font-medium text-slate-500">This stored record has no valid coordinates to plot.</p>
          </div>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 px-4 py-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
        <div><dt className="font-bold text-slate-500">Stored latitude</dt><dd className="mt-0.5 break-all font-extrabold text-slate-800">{hasCoordinates ? String(record.latitude) : 'Unavailable'}</dd></div>
        <div><dt className="font-bold text-slate-500">Stored longitude</dt><dd className="mt-0.5 break-all font-extrabold text-slate-800">{hasCoordinates ? String(record.longitude) : 'Unavailable'}</dd></div>
        <div><dt className="font-bold text-slate-500">Speed</dt><dd className="mt-0.5 font-extrabold text-slate-800">{Number.isFinite(record.speed) ? `${record.speed} km/h` : 'Unavailable'}</dd></div>
        <div><dt className="font-bold text-slate-500">GPS quality</dt><dd className="mt-0.5 font-extrabold text-slate-800">{record.gpsQuality || 'Unknown'}</dd></div>
        <div><dt className="font-bold text-slate-500">Route status</dt><dd className="mt-0.5 break-words font-extrabold text-slate-800">{record.routeStatus || 'Unknown'}</dd></div>
      </dl>
    </section>
  );
}

export function GpsHistoryExplorer({ buses = [], initialBusId = '' }) {
  const [filters, setFilters] = useState(() => readSavedFilters(initialBusId));
  const [selectedRecordKey, setSelectedRecordKey] = useState('');
  const [selectionScrollRequest, setSelectionScrollRequest] = useState(0);
  const [currentPageNumber, setCurrentPageNumber] = useState(1);
  const [pageJumpInput, setPageJumpInput] = useState('1');
  const [pageRetryToken, setPageRetryToken] = useState(0);
  const [countRefreshToken, setCountRefreshToken] = useState(0);
  const pageCacheRef = useRef(new Map());
  const countCacheRef = useRef(new Map());
  const historicalPointRef = useRef(null);
  const [pageState, setPageState] = useState({
    queryKey: '',
    status: 'loading',
    rows: [],
    error: '',
  });
  const [countState, setCountState] = useState({
    filterKey: '',
    status: 'loading',
    count: null,
    error: '',
  });

  const dateRange = useMemo(() => resolveGpsHistoryDateRange({
    preset: filters.preset,
    startDate: filters.startDate,
    endDate: filters.endDate,
  }), [filters.preset, filters.startDate, filters.endDate]);

  const filterKey = JSON.stringify({
    range: dateRange.valid ? [dateRange.startAt, dateRange.endAt] : [filters.preset, filters.startDate, filters.endDate],
    busId: filters.busId,
    status: filters.status,
  });
  const queryKey = JSON.stringify({
    filterKey,
    pageSize: filters.pageSize,
    pageNumber: currentPageNumber,
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // Session storage is a convenience only; the explorer still works without it.
    }
  }, [filters]);

  useEffect(() => {
    if (!initialBusId) return;
    pageCacheRef.current.clear();
    setCurrentPageNumber(1);
    setFilters((current) => current.busId === initialBusId ? current : { ...current, busId: initialBusId });
  }, [initialBusId]);

  useEffect(() => {
    setSelectedRecordKey('');
  }, [queryKey]);

  useEffect(() => {
    setPageJumpInput(String(currentPageNumber));
  }, [currentPageNumber]);

  useEffect(() => {
    let cancelled = false;
    if (!dateRange.valid) {
      setCountState({ filterKey, status: 'invalid', count: null, error: dateRange.error });
      return () => { cancelled = true; };
    }

    const cachedCount = countCacheRef.current.get(filterKey);
    if (cachedCount?.status === 'ready') {
      setCountState({ filterKey, status: 'ready', count: cachedCount.count, error: '' });
      return () => { cancelled = true; };
    }

    setCountState({ filterKey, status: 'loading', count: null, error: '' });
    let countRequest = cachedCount;
    if (!countRequest || countRequest.status !== 'pending') {
      countRequest = {
        status: 'pending',
        promise: fetchGpsHistoryCount(supabase, {
          startAt: dateRange.startAt,
          endAt: dateRange.endAt,
          busId: filters.busId,
          status: filters.status,
        }),
      };
      countCacheRef.current.set(filterKey, countRequest);
    }

    countRequest.promise.then((count) => {
      if (countCacheRef.current.get(filterKey) === countRequest) {
        countCacheRef.current.set(filterKey, { status: 'ready', count });
      }
      if (cancelled) return;
      setCountState({ filterKey, status: 'ready', count, error: '' });
    }).catch((error) => {
      if (countCacheRef.current.get(filterKey) === countRequest) {
        countCacheRef.current.delete(filterKey);
      }
      if (cancelled) return;
      setCountState({ filterKey, status: 'error', count: null, error: getHistoryErrorMessage(error) });
    });

    return () => { cancelled = true; };
  }, [filterKey, countRefreshToken]);

  useEffect(() => {
    let cancelled = false;
    if (!dateRange.valid) {
      setPageState({ queryKey, status: 'invalid', rows: [], error: dateRange.error });
      return () => { cancelled = true; };
    }

    if (pageCacheRef.current.has(queryKey)) {
      setPageState({ queryKey, status: 'ready', rows: pageCacheRef.current.get(queryKey), error: '' });
      return () => { cancelled = true; };
    }

    setPageState({ queryKey, status: 'loading', rows: [], error: '' });
    fetchGpsHistoryPage(supabase, {
      startAt: dateRange.startAt,
      endAt: dateRange.endAt,
      busId: filters.busId,
      status: filters.status,
      pageSize: filters.pageSize,
      pageNumber: currentPageNumber,
    }).then((result) => {
      if (cancelled) return;
      pageCacheRef.current.set(queryKey, result.rows);
      setPageState({
        queryKey,
        status: 'ready',
        rows: result.rows,
        error: '',
      });
    }).catch((error) => {
      if (cancelled) return;
      setPageState({ queryKey, status: 'error', rows: [], error: getHistoryErrorMessage(error) });
    });

    return () => { cancelled = true; };
  }, [queryKey, pageRetryToken]);

  const currentState = pageState.queryKey === queryKey
    ? pageState
    : { status: 'loading', rows: [], error: '' };
  const currentCountState = countState.filterKey === filterKey
    ? countState
    : { status: dateRange.valid ? 'loading' : 'invalid', count: null, error: dateRange.error || '' };
  const pageRows = currentState.rows || [];
  const totalRecordCount = currentCountState.status === 'ready' ? currentCountState.count : null;
  const totalPages = totalRecordCount === null ? 0 : getGpsHistoryTotalPages(totalRecordCount, filters.pageSize);
  const pageNumbers = getGpsHistoryPageNumbers(currentPageNumber, totalPages);
  const pageIsLoading = currentState.status === 'loading';
  const showPageNavigation = currentCountState.status === 'ready' && totalPages > 1;
  const selectedRecord = pageRows.find((record, index) => getRecordKey(record, index) === selectedRecordKey) || null;
  const selectedBus = selectedRecord ? buses.find((bus) => bus.id === selectedRecord.busId) : null;
  const selectedBusIndex = selectedRecord ? buses.findIndex((bus) => bus.id === selectedRecord.busId) : -1;
  const selectedBusLabel = getGpsHistoryBusLabel(selectedBus, Math.max(selectedBusIndex, 0));

  useEffect(() => {
    if (!selectedRecord) return;
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    historicalPointRef.current?.scrollIntoView?.({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, [selectionScrollRequest, selectedRecord?.id]);

  useEffect(() => {
    if (currentCountState.status !== 'ready') return;
    const pageCount = getGpsHistoryTotalPages(currentCountState.count, filters.pageSize);
    if (pageCount === 0 && currentPageNumber !== 1) setCurrentPageNumber(1);
    else if (pageCount > 0 && currentPageNumber > pageCount) setCurrentPageNumber(pageCount);
  }, [currentCountState.status, currentCountState.count, filters.pageSize, currentPageNumber]);

  const updateFilters = (changes) => {
    const queryFields = ['preset', 'startDate', 'endDate', 'busId', 'status', 'pageSize'];
    const changesQuery = queryFields.some((field) => Object.prototype.hasOwnProperty.call(changes, field) && changes[field] !== filters[field]);
    if (changesQuery) {
      pageCacheRef.current.clear();
      setCurrentPageNumber(1);
      setSelectedRecordKey('');
    }
    setFilters((current) => ({ ...current, ...changes }));
  };

  const selectPreset = (preset) => {
    const today = resolveGpsHistoryDateRange({ preset: 'today' }).startDate;
    updateFilters({
      preset,
      ...(preset === 'custom' ? {} : { startDate: today, endDate: today }),
    });
  };

  const goToPage = (page) => {
    if (!Number.isInteger(page) || page < 1 || page > totalPages || page === currentPageNumber || pageIsLoading) return;
    setSelectedRecordKey('');
    setCurrentPageNumber(page);
  };

  const selectHistoricalRecord = (recordKey) => {
    setSelectedRecordKey(recordKey);
    setSelectionScrollRequest((request) => request + 1);
  };

  const submitPageJump = (event) => {
    event.preventDefault();
    const page = Number(pageJumpInput);
    if (Number.isSafeInteger(page)) goToPage(page);
  };

  const retryPage = () => {
    pageCacheRef.current.delete(queryKey);
    setPageState({ queryKey, status: 'loading', rows: [], error: '' });
    setPageRetryToken((value) => value + 1);
  };

  const retryCount = () => {
    countCacheRef.current.delete(filterKey);
    setCountState({ filterKey, status: 'loading', count: null, error: '' });
    setCountRefreshToken((value) => value + 1);
  };

  const refreshCurrentPageAndCount = () => {
    pageCacheRef.current.clear();
    countCacheRef.current.delete(filterKey);
    setPageState({ queryKey, status: 'loading', rows: [], error: '' });
    setCountState({ filterKey, status: 'loading', count: null, error: '' });
    setPageRetryToken((value) => value + 1);
    setCountRefreshToken((value) => value + 1);
  };

  const exportCurrentPage = () => {
    if (pageRows.length === 0) return;
    const csv = buildGpsHistoryCsv(pageRows, buses);
    const downloadUrl = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = downloadUrl;
    const dateName = dateRange.valid ? dateRange.startDate : 'gps-history';
    link.download = `centrabus-gps-history-${dateName}-page-${currentPageNumber}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  };

  const pageRange = totalRecordCount === null
    ? { from: 0, to: 0 }
    : getGpsHistoryPageRange(totalRecordCount, currentPageNumber, filters.pageSize);
  const formattedTotal = totalRecordCount === null ? '' : new Intl.NumberFormat('en-PH').format(totalRecordCount);
  const formattedFrom = new Intl.NumberFormat('en-PH').format(pageRange.from);
  const formattedTo = new Intl.NumberFormat('en-PH').format(pageRange.to);
  const formatCount = (value) => new Intl.NumberFormat('en-PH').format(value);
  const rangeLabel = dateRange.valid
    ? `${formatGpsHistoryPeriod(dateRange.startDate, dateRange.endDate)} / Philippine time`
    : 'Invalid date range';
  const totalSummaryValue = currentCountState.status === 'ready'
    ? `${formattedTotal} record${totalRecordCount === 1 ? '' : 's'}`
    : currentCountState.status === 'error'
      ? 'Unavailable'
      : currentCountState.status === 'invalid'
        ? 'Check date range'
        : 'Loading…';
  const capturePeriodSummary = pageRows.length
    ? pageRows.length === 1
      ? `Current page · ${formatGpsHistoryTimestamp(pageRows[0].capturedAt)}`
      : `Current page · ${formatGpsHistoryTimestamp(pageRows[pageRows.length - 1].capturedAt)} – ${formatGpsHistoryTimestamp(pageRows[0].capturedAt)}`
    : 'No records on this page';
  const tableSummary = currentState.status === 'loading'
    ? 'Loading records…'
    : currentState.status === 'ready'
      ? pageRows.length
        ? currentCountState.status === 'ready'
          ? `Showing ${formattedFrom}–${formattedTo} of ${formattedTotal} records`
          : currentCountState.status === 'error' ? 'Page ready · matching total unavailable' : 'Page ready · calculating matching total…'
        : 'No matching records'
      : currentState.status === 'error'
        ? 'This page could not be loaded'
        : 'Choose a valid date range';

  const renderOperationalRows = () => {
    let previousDay = '';
    return pageRows.map((record, index) => {
      const recordKey = getRecordKey(record, index);
      const day = getGpsHistoryDateGroup(record.capturedAt);
      const movement = getMovementPresentation(record.motionStatus);
      const route = getRoutePresentation(record.routeStatus);
      const quality = String(record.gpsQuality || 'Unknown');
      const busIndex = buses.findIndex((bus) => bus.id === record.busId);
      const bus = busIndex >= 0 ? buses[busIndex] : null;
      const busLabel = getGpsHistoryBusLabel(bus, Math.max(busIndex, 0));
      const startsNewDay = day !== previousDay;
      previousDay = day;
      return (
        <Fragment key={recordKey}>
          {startsNewDay && <tr className="bg-slate-50"><th colSpan="8" scope="rowgroup" className="px-4 py-2 text-left text-xs font-extrabold text-slate-600">{day} · Philippine time</th></tr>}
          <tr tabIndex={0} onClick={() => selectHistoricalRecord(recordKey)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectHistoricalRecord(recordKey); } }} aria-selected={selectedRecordKey === recordKey} className={`border-t border-slate-100 align-middle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#A1262F] ${selectedRecordKey === recordKey ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
            <td className="px-4 py-3 text-sm font-semibold text-slate-700">{formatGpsHistoryTimestamp(record.capturedAt)}</td>
            <td className="px-4 py-3"><div className="max-w-48 truncate font-extrabold text-slate-900">{busLabel}</div><div className="mt-0.5 max-w-48 truncate text-xs font-medium text-slate-500">{bus?.busCode || bus?.deviceId || 'Fleet vehicle'}</div></td>
            <td className="px-4 py-3 font-bold text-slate-800">{record.speed === null ? 'Unavailable' : `${record.speed.toFixed(2)} km/h`}</td>
            <td className="px-4 py-3"><TextStatus value={movement.label} tone={movement.tone} /></td>
            <td className="px-4 py-3"><TextStatus value={quality} tone={quality.toUpperCase() === 'GOOD' ? 'good' : quality.toUpperCase() === 'WEAK' ? 'warning' : 'neutral'} /></td>
            <td className="px-4 py-3"><TextStatus value={route.label} tone={route.tone} /></td>
            <td className="px-4 py-3 text-sm font-semibold text-slate-700">{record.distanceFromRouteM === null ? '—' : `${record.distanceFromRouteM.toFixed(1)} m`}</td>
            <td className="px-4 py-3"><button type="button" aria-pressed={selectedRecordKey === recordKey} onClick={(event) => { event.stopPropagation(); selectHistoricalRecord(recordKey); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]">{hasGpsHistoryCoordinates(record) ? 'Show point' : 'Select record'}</button></td>
          </tr>
        </Fragment>
      );
    });
  };

  const renderRawRows = () => pageRows.map((record, index) => {
    const recordKey = getRecordKey(record, index);
    return (
      <tr key={recordKey} tabIndex={0} onClick={() => selectHistoricalRecord(recordKey)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectHistoricalRecord(recordKey); } }} aria-selected={selectedRecordKey === recordKey} className={`border-t border-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#A1262F] ${selectedRecordKey === recordKey ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
        <td className="px-3 py-3 text-sm font-semibold text-slate-700">{formatGpsHistoryTimestamp(record.capturedAt)}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-600">{record.createdAt ? formatGpsHistoryTimestamp(record.createdAt) : '—'}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-700">{record.busId || '—'}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-600">{record.id ?? '—'}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-600">{record.sourceRecordId || '—'}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-700">{record.latitude ?? '—'}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-700">{record.longitude ?? '—'}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-700">{record.speed ?? '—'}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-700">{record.horizontalAccuracyM ?? '—'}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-700">{record.filterState || '—'}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-700">{record.consistency || '—'}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-700">{record.gpsQuality || '—'}</td>
        <td className="px-3 py-3 text-xs font-semibold text-slate-700">{record.routeStatus || '—'}</td>
        <td className="px-3 py-3"><button type="button" aria-pressed={selectedRecordKey === recordKey} onClick={(event) => { event.stopPropagation(); selectHistoricalRecord(recordKey); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]">Select point</button></td>
      </tr>
    );
  });

  return (
    <section className="min-w-0 space-y-4">
      <div className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold text-slate-950">GPS History Explorer</h1>
            <p className="mt-1 text-sm font-medium text-slate-500">Explore recorded GPS fixes by Philippine date, vehicle, and telemetry status.</p>
          </div>
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="GPS history view">
            <button type="button" role="tab" aria-selected={filters.view === 'operational'} onClick={() => updateFilters({ view: 'operational' })} className={`rounded-lg px-3 py-2 text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F] ${filters.view === 'operational' ? 'bg-white text-[#8E1F2F] shadow-sm' : 'text-slate-600'}`}>Operational History</button>
            <button type="button" role="tab" aria-selected={filters.view === 'raw'} onClick={() => updateFilters({ view: 'raw' })} className={`rounded-lg px-3 py-2 text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F] ${filters.view === 'raw' ? 'bg-white text-[#8E1F2F] shadow-sm' : 'text-slate-600'}`}>Raw GPS Records</button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" aria-label="Quick date filters">
          {[
            ['today', 'Today'],
            ['yesterday', 'Yesterday'],
            ['last7Days', 'Last 7 Days'],
            ['custom', 'Custom Range'],
          ].map(([preset, label]) => (
            <button key={preset} type="button" aria-pressed={filters.preset === preset} onClick={() => selectPreset(preset)} className={`rounded-full border px-3.5 py-2 text-sm font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F] ${filters.preset === preset ? 'border-[#8E1F2F] bg-[#8E1F2F] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{label}</button>
          ))}
        </div>

        <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_minmax(180px,1fr)_minmax(165px,0.8fr)_minmax(120px,0.6fr)]">
          {filters.preset === 'custom' && <>
            <label className="grid min-w-0 gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500">Start date (Philippine time)<span className="relative"><CalendarDays size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" /><input aria-label="Start date" type="date" value={filters.startDate} onChange={(event) => updateFilters({ preset: 'custom', startDate: event.target.value })} className="w-full min-w-0 rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]" /></span></label>
            <label className="grid min-w-0 gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500">End date (Philippine time)<span className="relative"><CalendarDays size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" /><input aria-label="End date" type="date" value={filters.endDate} onChange={(event) => updateFilters({ preset: 'custom', endDate: event.target.value })} className="w-full min-w-0 rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]" /></span></label>
          </>}
          <label className="grid min-w-0 gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500">Bus<select aria-label="Filter by bus" value={filters.busId} onChange={(event) => updateFilters({ busId: event.target.value })} className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold normal-case tracking-normal text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]"><option value={GPS_HISTORY_ALL_BUSES}>All buses</option>{buses.map((bus, index) => <option key={bus.id} value={bus.id}>{getBusOptionLabel(bus, index)}</option>)}</select></label>
          <label className="grid min-w-0 gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500">Status<select aria-label="Filter by status" value={filters.status} onChange={(event) => updateFilters({ status: event.target.value })} className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold normal-case tracking-normal text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]">{Object.entries(GPS_HISTORY_STATUS_FILTERS).map(([key, filter]) => <option key={key} value={key}>{filter.label}</option>)}</select></label>
          <label className="grid min-w-0 gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-500">Records per page<select aria-label="Records per page" value={filters.pageSize} onChange={(event) => updateFilters({ pageSize: normalizeGpsHistoryPageSize(event.target.value) })} className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold normal-case tracking-normal text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A1262F]">{GPS_HISTORY_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        </div>
      </div>

      <section aria-label="Filtered GPS history summary" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Selected bus</div><div className="mt-1 truncate text-sm font-extrabold text-slate-900">{filters.busId === GPS_HISTORY_ALL_BUSES ? 'All buses' : getGpsHistoryBusLabel(buses.find((bus) => bus.id === filters.busId), Math.max(buses.findIndex((bus) => bus.id === filters.busId), 0))}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Total records</div><div className="mt-1 text-sm font-extrabold text-slate-900">{totalSummaryValue}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Capture period</div><div className="mt-1 text-sm font-extrabold text-slate-900">{rangeLabel}</div><div className="mt-1 text-xs font-medium text-slate-500">{capturePeriodSummary}</div></div>
      </section>

      {selectedRecord && <HistoricalGpsPointMap record={selectedRecord} busLabel={selectedBusLabel} panelRef={historicalPointRef} onClose={() => setSelectedRecordKey('')} />}

      {dateRange.valid === false && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">{dateRange.error}</div>}
      {currentCountState.status === 'error' && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800"><span>Exact matching total is unavailable. {currentCountState.error} Numbered page navigation is unavailable until the total loads.</span><button type="button" onClick={retryCount} className="rounded-lg border border-red-200 bg-white px-3 py-2 font-extrabold">Retry total</button></div>}
      {currentState.status === 'error' && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800"><span>{currentState.error}</span><button type="button" onClick={retryPage} className="rounded-lg border border-red-200 bg-white px-3 py-2 font-extrabold">Retry page</button></div>}

      <section className="min-w-0 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm" aria-label="GPS history records">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0"><h2 className="text-base font-extrabold text-slate-900">{filters.view === 'operational' ? 'Operational History' : 'Raw GPS Records'}</h2><p className="mt-0.5 text-xs font-semibold text-slate-500">{tableSummary}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={refreshCurrentPageAndCount} disabled={pageIsLoading || currentCountState.status === 'loading'} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCcw size={15} aria-hidden="true" />Refresh</button>
            <button type="button" onClick={exportCurrentPage} disabled={pageRows.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-[#E9C3C8] bg-white px-3 py-2 text-sm font-extrabold text-[#8E1F2F] hover:bg-[#FBEDEE] disabled:cursor-not-allowed disabled:opacity-50"><Download size={15} aria-hidden="true" />Export current page CSV</button>
          </div>
        </div>

        <div className="max-h-[62vh] min-h-[240px] overflow-auto" role="region" aria-label="Scrollable GPS history table" tabIndex={0}>
          <table className={`w-full text-left ${filters.view === 'raw' ? 'min-w-[1500px] text-xs' : 'min-w-[980px] text-sm'}`}>
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_#e2e8f0]">
              {filters.view === 'operational' ? (
                <tr>{['Time · PHT', 'Bus', 'Speed', 'Movement', 'GPS quality', 'Route status', 'Route distance', 'Historical point'].map((heading) => <th key={heading} scope="col" className="px-4 py-3 font-extrabold">{heading}</th>)}</tr>
              ) : (
                <tr>{['captured_at · PHT', 'created_at', 'bus_id', 'id', 'source_record_id', 'latitude', 'longitude', 'speed', 'horizontal accuracy', 'filter state', 'consistency', 'GPS quality', 'route_status', 'map'].map((heading) => <th key={heading} scope="col" className="px-3 py-3 font-extrabold">{heading}</th>)}</tr>
              )}
            </thead>
            <tbody>
              {currentState.status === 'loading' ? <tr><td colSpan={filters.view === 'operational' ? 8 : 14} className="p-10 text-center text-sm font-semibold text-slate-500" role="status">Loading GPS history for {rangeLabel}…</td></tr>
                : currentState.status === 'error' ? <tr><td colSpan={filters.view === 'operational' ? 8 : 14} className="p-10 text-center text-sm font-semibold text-slate-500">History is unavailable until the read succeeds.</td></tr>
                  : currentState.status === 'invalid' ? <tr><td colSpan={filters.view === 'operational' ? 8 : 14} className="p-10 text-center text-sm font-semibold text-slate-500">Correct the date range to search GPS history.</td></tr>
                  : pageRows.length === 0 ? <tr><td colSpan={filters.view === 'operational' ? 8 : 14} className="p-10 text-center"><div className="text-sm font-extrabold text-slate-800">No GPS records for this selection</div><div className="mt-1 text-sm font-medium text-slate-500">Try another date range, bus, or status.</div></td></tr>
                    : filters.view === 'operational' ? renderOperationalRows() : renderRawRows()}
            </tbody>
          </table>
        </div>

        {showPageNavigation && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-4 py-3 sm:px-5">
          <nav aria-label="GPS history page navigation" className="flex flex-wrap items-center justify-center gap-1.5">
            {currentPageNumber > 1 && <button type="button" onClick={() => goToPage(currentPageNumber - 1)} disabled={pageIsLoading} aria-label="Previous GPS history page" className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-sm font-extrabold text-slate-700 disabled:cursor-not-allowed disabled:opacity-45"><ChevronLeft size={16} aria-hidden="true" /></button>}
            {pageNumbers.map((page) => typeof page === 'number'
              ? <button key={page} type="button" onClick={() => goToPage(page)} disabled={pageIsLoading || page === currentPageNumber} aria-label={`Go to GPS history page ${page}`} aria-current={page === currentPageNumber ? 'page' : undefined} className={`h-9 min-w-9 rounded-lg border px-2 text-sm font-extrabold disabled:cursor-default ${page === currentPageNumber ? 'border-[#8E1F2F] bg-[#8E1F2F] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50'}`}>{page}</button>
              : <span key={page} aria-hidden="true" className="px-1 text-sm font-bold text-slate-500">…</span>)}
            {currentPageNumber < totalPages && <button type="button" onClick={() => goToPage(currentPageNumber + 1)} disabled={pageIsLoading} aria-label="Next GPS history page" className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-sm font-extrabold text-slate-700 disabled:cursor-not-allowed disabled:opacity-45"><ChevronRight size={16} aria-hidden="true" /></button>}
            <span className="ml-1 whitespace-nowrap text-xs font-semibold text-slate-500">Page {currentPageNumber} of {formatCount(totalPages)}</span>
            <form onSubmit={submitPageJump} className="ml-1 inline-flex items-center gap-1.5">
              <label htmlFor="gps-history-page-jump" className="sr-only">Go to page number</label>
              <input id="gps-history-page-jump" aria-label="Go to GPS history page" type="number" min="1" max={totalPages} value={pageJumpInput} onChange={(event) => setPageJumpInput(event.target.value)} disabled={pageIsLoading} className="h-9 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm font-bold text-slate-700 disabled:opacity-50" />
              <button type="submit" disabled={pageIsLoading || !Number.isSafeInteger(Number(pageJumpInput)) || Number(pageJumpInput) === currentPageNumber || Number(pageJumpInput) > totalPages || Number(pageJumpInput) < 1} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Go</button>
            </form>
          </nav>
        </div>}
      </section>
    </section>
  );
}

export default GpsHistoryExplorer;
