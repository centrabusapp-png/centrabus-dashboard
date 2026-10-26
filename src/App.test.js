import { useState } from 'react';
import { cameraSnapshot, TEST_CALIBRATION } from './camera/testing/fixtures';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
const { readFileSync } = require('fs');
const { join } = require('path');
import App, {
  normalizeOperationalBuses,
  buildApplicationAlerts,
  getFleetHealthCounts,
  hasValidatedConditionData,
  getNeedsAttentionIssues,
  getOverallVehicleCondition,
  getValidSelectedBusId,
  getGpsFreshness,
  getGpsSampleTimestamp,
  appendGpsSpeedSample,
  deriveBackendHealthStatus,
  deriveDashboardConnectivityStatus,
  deriveRealtimeHealth,
  deriveSystemHealth,
  SystemHealthCard,
  SettingsPage,
  normalizeNotificationPreferences,
  isRetiredTirePressureAlert,
  getRouteStatusPresentation,
  formatDistanceFromRoute,
  isConfirmedRouteDeviation,
  hasRegisteredDuplicatePlate,
  isValidPlateNumber,
  normalizeLiveGpsRecord,
  normalizePersistedGpsRecord,
  appendLiveGpsHistory,
  mergeLiveGpsHistory,
  buildLiveGpsActivityRecords,
  buildActivityRecordsCsv,
  normalizePlateNumber,
  MonitoringOverviewFleet,
  BusDetailsPanel,
  AnimatedBusMarker,
  BusMarkerCallout,
  BUS_MARKER_MIN_SIZE,
  BUS_MARKER_MAX_SIZE,
  createBusMarkerIcon,
  createSharedBusMarkerIcon,
  BUS_MARKER_SHARED_LOCATION_TOLERANCE_M,
  getBusMarkerIdentityColor,
  getNearbyBusMarkerOffsets,
  getOffsetBusMarkerPosition,
  getOverlappingBuses,
  BUS_OVERLAP_DISTANCE_M,
  BUS_MARKER_NEARBY_DISTANCE_PX,
  BUS_MARKER_SHARED_ANCHOR_DISTANCE_PX,
  FitFleetBounds,
  getBusMarkerSize,
  getBusMarkerHitTargetSize,
  MapViewportController,
  ZoomAwareBusMarkers,
  getBusCalloutPlacement,
  deriveMonitoringState,
  SummaryCards,
  VehicleConditionSummary,
  VehicleConditionPage,
  VehicleConditionOverview,
  FleetHealthCard,
  NeedsAttentionCard,
  AlertsPage,
  getBusCoordinates,
  getTripRoutePoints,
  useRoadRoute,
  AssignedRouteLine,
  LeafletMapPanel,
  visibleRouteName,
  getRouteAssessmentPresentation,
  getMarkerGpsFreshness,
  isMarkerEligible,
  getFleetResetTarget,
  getMarkerAnimationDuration,
  useAlertNotification,
  AlertNotification,
} from './App';

describe('retired corridor presentation', () => {
  const bus = { id: 'corridor-bus', plateNumber: 'BUS 04', status: 'active', routeName: 'FPIP–LIMA',
    gps: { latitude: 14.095, longitude: 121.16, gpsUpdatedAt: 100000, rawSpeedKmh: 0.5, routeStatus: 'ON ROUTE', distanceFromRouteM: 4 } };
  test.each(['LIMA–FPIP', 'FPIP–LIMA', 'lima - fpip', ' FPIP — LIMA ', 'LIMA→FPIP'])('hides %s without altering other named routes', (name) => {
    expect(visibleRouteName(name)).toBeNull();
    expect(visibleRouteName('Route A')).toBe('Route A');
  });
  test('condition page, details and marker popup omit retired labels without mutating source records', () => {
    const reverse = { ...bus, id: 'reverse', plateNumber: 'BUS 159', routeName: 'LIMA–FPIP' };
    const original = JSON.stringify([bus, reverse]);
    const ui = render(<><VehicleConditionPage buses={[bus, reverse]} selectedBus={reverse} selectedBusId={reverse.id}
      fleetStatus="ready" nowMs={105000} frameService={{ enabled: false }} onSelectBus={jest.fn()} onNavigate={jest.fn()} />
      <BusDetailsPanel bus={bus} nowMs={105000} onNavigate={jest.fn()} /><BusMarkerCallout bus={reverse} nowMs={105000} /></>);
    expect(ui.container).not.toHaveTextContent(/(?:LIMA\s*[-–—→]\s*FPIP|FPIP\s*[-–—→]\s*LIMA)/i);
    expect(JSON.stringify([bus, reverse])).toBe(original);
    expect(screen.getAllByText('GPS Status')).toHaveLength(1);
  });
  test.each([true, false])('fleet map compact=%s does not draw or fetch a route line while GPS markers remain', (compact) => {
    const selectedTrip = { status: 'Active', routeLabel: 'FPIP–LIMA', originCoordinates: { lat: 14.135645, lng: 121.122123 }, destinationCoordinates: { lat: 14.008703, lng: 121.169172 } };
    const ui = render(<LeafletMapPanel compact={compact} selectedBus={bus} selectedTrip={selectedTrip} monitoredBuses={[bus]}
      nowMs={105000} routeSafeRadiusM={100} onSelect={jest.fn()} onCenterBus={jest.fn()} onNavigate={jest.fn()} showDetails />);
    expect(screen.queryByTestId('assigned-route-line')).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Marker 14.095,121.16' })).toBeInTheDocument();
    expect(ui.container).not.toHaveTextContent('FPIP–LIMA');
  });
});

describe('compact Vehicle Condition page', () => {
  const bus = { id: 'internal-bus-long-id', plateNumber: 'BUS 159', status: 'active', routeName: 'LIMA–FPIP',
    gps: { latitude: 14, longitude: 121, gpsUpdatedAt: 100000, rawSpeedKmh: 0.5, routeStatus: 'ON ROUTE', distanceFromRouteM: 4 } };
  const buses = [bus, { ...bus, id: 'second-internal-id', plateNumber: 'BUS 04' }];
  test('shows important controls and six compact gauges without duplicate explanations or internal IDs', () => {
    const onNavigate = jest.fn();
    const { container } = render(<VehicleConditionPage buses={buses} selectedBus={bus} selectedBusId={bus.id}
      fleetStatus="ready" nowMs={105000} frameService={{ enabled: false }} onSelectBus={jest.fn()} onNavigate={onNavigate} />);
    expect(screen.getByRole('heading', { name: 'Gauge readings' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(6);
    expect(container.querySelectorAll('.camera-condition-gauge.is-compact')).toHaveLength(6);
    expect(screen.getByText('GPS Online · 5s ago')).toBeInTheDocument();
    expect(screen.getByText('0.5 km/h')).toBeInTheDocument();
    expect(screen.getByText('On Route')).toBeInTheDocument();
    expect(screen.queryByText(/Bus ID:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Needs Attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Quick Actions')).not.toBeInTheDocument();
    expect(screen.queryByText(/Gauge details will appear/)).not.toBeInTheDocument();
    expect(screen.queryByText('Force Refresh Data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Live camera' }));
    expect(onNavigate).toHaveBeenLastCalledWith('live-camera');
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ page: 'records', bus: bus.id, tab: 'condition-history' });
    fireEvent.click(screen.getByRole('button', { name: 'View selected bus on map' }));
    expect(onNavigate).toHaveBeenLastCalledWith('map');
  });
  test('bus search and selection still work by hidden internal ID or visible plate', () => {
    const onSelectBus = jest.fn();
    render(<VehicleConditionPage buses={buses} selectedBus={bus} selectedBusId={bus.id}
      fleetStatus="ready" nowMs={105000} frameService={{ enabled: false }} onSelectBus={onSelectBus} onNavigate={jest.fn()} />);
    const search = screen.getByRole('textbox', { name: 'Search buses by plate number or Bus ID' });
    fireEvent.change(search, { target: { value: 'second-internal' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('option'));
    expect(onSelectBus).toHaveBeenCalledWith(buses[1]);
    fireEvent.change(search, { target: { value: '159' } });
    expect(screen.getByRole('option')).toHaveTextContent('BUS 159');
  });
  test('compact bus summary does not present an old route assessment as current', () => {
    render(<BusDetailsPanel compact bus={bus} nowMs={100000 + 13 * 3600000} onNavigate={jest.fn()} />);
    expect(screen.getByText('Last known: On Route')).toHaveAttribute('data-route-tone', 'unavailable');
    expect(screen.getByText(/GPS Stale/)).toBeInTheDocument();
    expect(screen.queryByText(/^On Route$/)).not.toBeInTheDocument();
  });
});

describe('route provenance, overlay direction and last-known presentation', () => {
  const forward = { routeLabel: 'FPIP–LIMA', originCoordinates: { lat: 14.135645, lng: 121.122123 }, destinationCoordinates: { lat: 14.008703, lng: 121.169172 } };
  const reverse = { routeLabel: 'LIMA–FPIP', originCoordinates: forward.destinationCoordinates, destinationCoordinates: forward.originCoordinates };
  test('keeps forward and other routes, hides reverse without changing assignments', () => {
    const copy = JSON.stringify(reverse);
    expect(getTripRoutePoints(forward)).toEqual([forward.originCoordinates, forward.destinationCoordinates]);
    expect(getTripRoutePoints(null).length).toBeGreaterThan(2);
    expect(getTripRoutePoints(reverse)).toEqual([]);
    expect(getTripRoutePoints({ ...reverse, routeLabel: 'Renamed route' })).toEqual([]);
    expect(getTripRoutePoints({ ...forward, routeLabel: 'Other route' })).toHaveLength(2);
    expect(JSON.stringify(reverse)).toBe(copy);
  });
  test('marker prefers assessed filtered coordinates over responsive legacy coordinates', () => {
    expect(getBusCoordinates({ gps: { latitude: 14, longitude: 121, liveLatitude: 14.01, liveLongitude: 121.01 } })).toEqual({ lat: 14, lng: 121 });
    expect(getBusCoordinates({ gps: { liveLatitude: 14.01, liveLongitude: 121.01 } })).toEqual({ lat: 14.01, lng: 121.01 });
    expect(getRouteAssessmentPresentation({ liveLatitude: 14.01, liveLongitude: 121.01, gpsUpdatedAt: 100000, routeStatus: 'ON ROUTE' }, 105000).lastKnown).toBe(true);
  });
  test.each(['Stale', 'Offline', 'Delayed', 'Unknown'])('%s route assessment is neutral last-known information', (status) => {
    const gps = { latitude: 14, longitude: 121, routeStatus: 'ON ROUTE', gpsUpdatedAt: status === 'Unknown' ? null : 100000, online: status !== 'Offline' };
    const presentation = getRouteAssessmentPresentation(gps, status === 'Delayed' ? 145000 : 100000 + 107 * 3600000);
    expect(presentation.label).toBe('Last known: On Route');
    expect(presentation.tone).toBe('unavailable');
    expect(presentation.capturedAt).toBe(status === 'Unknown' ? null : '1970-01-01T00:01:40.000Z');
  });
  test('fresh route status remains current and stale popup identifies original capture time', () => {
    const bus = { id: 'old', plateNumber: 'ABC 234', status: 'active', gps: { latitude: 14, longitude: 121, gpsUpdatedAt: 100000, routeStatus: 'ON ROUTE', distanceFromRouteM: 6 } };
    expect(getRouteAssessmentPresentation(bus.gps, 105000).label).toBe('On Route');
    render(<BusMarkerCallout bus={bus} nowMs={100000 + 107 * 3600000} />);
    expect(screen.getByText('Last known: On Route')).toHaveAttribute('data-route-tone', 'unavailable');
    expect(screen.getByText(/Not currently verified.*1970-01-01T00:01:40.000Z/)).toBeInTheDocument();
    expect(screen.queryByText('On Route')).not.toBeInTheDocument();
  });
  test('reverse route cannot fetch or reappear after switching/remounting, including late OSRM response', async () => {
    const original = global.fetch;
    let resolve;
    global.fetch = jest.fn(() => new Promise((done) => { resolve = done; }));
    try {
      const uniqueForward = { ...forward, originCoordinates: { lat: 14.135646, lng: 121.122124 } };
      const { result, rerender, unmount } = renderHook(({ trip }) => useRoadRoute(getTripRoutePoints(trip)), { initialProps: { trip: uniqueForward } });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      rerender({ trip: reverse });
      expect(result.current.points).toEqual([]);
      await act(async () => { resolve({ ok: true, json: async () => ({ code: 'Ok', routes: [{ geometry: { coordinates: [[121, 14], [122, 15]] } }] }) }); });
      expect(result.current.points).toEqual([]);
      unmount();
      const again = renderHook(() => useRoadRoute(getTripRoutePoints(reverse)));
      expect(again.result.current.points).toEqual([]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      again.unmount();
    } finally { global.fetch = original; }
  });
  test('forward overlay renders once, disappears for reverse, and restores once from cache', async () => {
    const original = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ code: 'Ok', routes: [{ geometry: { coordinates: [[121.122123, 14.135645], [121.169172, 14.008703]] } }] }) }));
    function Overlay({ trip }) {
      const route = useRoadRoute(getTripRoutePoints(trip));
      return <AssignedRouteLine routePoints={route.points} />;
    }
    try {
      const view = render(<Overlay trip={forward} />);
      await screen.findByTestId('assigned-route-line');
      expect(screen.getAllByTestId('assigned-route-line')).toHaveLength(1);
      view.rerender(<Overlay trip={reverse} />);
      expect(screen.queryByTestId('assigned-route-line')).not.toBeInTheDocument();
      view.rerender(<Overlay trip={forward} />);
      expect(screen.getAllByTestId('assigned-route-line')).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      view.unmount();
      render(<Overlay trip={reverse} />);
      expect(screen.queryByTestId('assigned-route-line')).not.toBeInTheDocument();
    } finally { global.fetch = original; }
  });
});

const mockLeafletMap = {
  invalidateSize: jest.fn(),
  getContainer: () => null,
  setView: jest.fn(),
  fitBounds: jest.fn(),
  flyTo: jest.fn(),
  flyToBounds: jest.fn(),
  getZoom: jest.fn(() => 12),
  on: jest.fn(),
  off: jest.fn(),
};

test('existing Gauge Panel has default-off camera integration and no queries when calibration missing', () => {
  const service = { readLatest: jest.fn() };
  const { rerender } = render(<VehicleConditionSummary bus={{ id: 'test-bus' }} onNavigate={jest.fn()} cameraService={service} />);
  expect(screen.queryByTestId('camera-gauge-panel')).not.toBeInTheDocument(); expect(service.readLatest).not.toHaveBeenCalled();
  rerender(<VehicleConditionSummary bus={{ id: 'test-bus' }} onNavigate={jest.fn()} cameraEnabled cameraService={service} />);
  expect(screen.getByTestId('camera-gauge-panel')).toHaveTextContent('Approved calibration'); expect(service.readLatest).not.toHaveBeenCalled();
});
test('existing Gauge Panel renders camera numerical cards without legacy scales or fabricated condition alerts', async () => {
  const capturedAt = new Date(Date.now() - 1000).toISOString();
  const snapshot = cameraSnapshot({ captured_at: capturedAt, received_at: capturedAt, processed_at: capturedAt });
  const service = { readLatest: jest.fn(async () => snapshot) };
  render(<VehicleConditionSummary bus={{ id: 'test-bus' }} onNavigate={jest.fn()} cameraEnabled cameraService={service} cameraCalibration={TEST_CALIBRATION} />);
  await screen.findByText('42 fixture-unit');
  const panel = screen.getByTestId('camera-gauge-panel');
  expect(panel).toHaveTextContent('Oil gauge (meaning unconfirmed)'); expect(panel).not.toHaveTextContent('Oil Level');
  expect(panel.querySelector('svg line')).toBeNull(); expect(panel).not.toHaveTextContent('Normal');
  expect(panel).toHaveTextContent(capturedAt); expect(service.readLatest).toHaveBeenCalledTimes(1);
});

test('isolated synthetic Express/Python/repository output reaches the actual Gauge Panel without live integration', async () => {
  const { execFile } = require('child_process');
  const runner = join(__dirname, '../../backend/camera/testing/harnessProcess.js');
  const allowedEnv = ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'CENTRABUS_CAMERA_TEST_PYTHON'];
  const env = Object.fromEntries(allowedEnv.filter((key) => process.env[key] != null).map((key) => [key, process.env[key]]));
  const output = await new Promise((resolve, reject) => execFile(process.execPath, [runner, '--synthetic-local-test-only'],
    { windowsHide: true, timeout: 15000, maxBuffer: 65536, env }, (error, stdout) => error ? reject(new Error('isolated-harness-failed')) : resolve(stdout)));
  const result = JSON.parse(output);
  // Blocked hardware/CV dependencies are not turned into a mock PASS here.
  expect(result.blocked).toBeUndefined(); expect(result.failed).toBeUndefined();
  expect(result.accepted.status).toBe(201); expect(result.unclear.body.error).toBe('image-unclear');
  expect(output).not.toMatch(/base64|image_path|authorization/);
  const service = { readLatest: jest.fn(async () => result.snapshot) };
  const calibration = { ...TEST_CALIBRATION, algorithm_version: 'test-radial-v1' };
  render(<VehicleConditionSummary bus={{ id: 'test-bus-1' }} onNavigate={jest.fn()} cameraEnabled cameraService={service} cameraCalibration={calibration} />);
  const reading = result.snapshot.readings[0];
  await screen.findByText(`${reading.numeric_value} fixture-unit`);
  const panel = screen.getByTestId('camera-gauge-panel');
  expect(panel).toHaveTextContent(reading.captured_at); expect(panel).toHaveTextContent('Awaiting Data');
  expect(panel).not.toHaveTextContent('Normal'); expect(panel).not.toHaveTextContent('Oil Level');
  expect(service.readLatest).toHaveBeenCalledTimes(1);
}, 20000);

test('synthetic Pi camera sender retry reaches Gauge Panel with six distinct gauges and original capture time', async () => {
  const { execFile } = require('child_process');
  const runner = join(__dirname, '../../backend/camera/testing/senderHarnessProcess.js');
  const allowedEnv = ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'CENTRABUS_CAMERA_TEST_PYTHON'];
  const env = Object.fromEntries(allowedEnv.filter((key) => process.env[key] != null).map((key) => [key, process.env[key]]));
  const output = await new Promise((resolve, reject) => execFile(process.execPath, [runner, '--synthetic-sender-test-only'],
    { windowsHide: true, timeout: 15000, maxBuffer: 65536, env }, (error, stdout) => error ? reject(new Error('synthetic-sender-harness-failed')) : resolve(stdout)));
  const result = JSON.parse(output);
  expect(result.result.ok).toBe(true); expect(result.result.receipt.duplicate).toBe(true); expect(result.records).toBe(1);
  expect(result.snapshot.readings.map((reading) => reading.gauge_key)).toEqual(['fuel', 'coolant', 'frontAir', 'rearAir', 'battery', 'oilPressure']);
  expect(output).not.toMatch(/base64|image_path|authorization|Bearer/);
  const service = { readLatest: jest.fn(async () => result.snapshot) };
  const calibration = { ...result.calibration, staleAfterMs: 30000, maxFutureSkewMs: 2000 };
  render(<VehicleConditionSummary bus={{ id: 'test-bus-1' }} onNavigate={jest.fn()} cameraEnabled cameraService={service} cameraCalibration={calibration} />);
  await screen.findByText(`${result.snapshot.readings[0].numeric_value} fixture-unit`);
  const panel = screen.getByTestId('camera-gauge-panel');
  result.snapshot.readings.forEach((reading) => {
    expect(panel).toHaveTextContent(`${reading.numeric_value} fixture-unit`);
    expect(reading.captured_at).toBe(result.capturedAt);
  });
  expect(panel).toHaveTextContent('Oil gauge (meaning unconfirmed)'); expect(panel).toHaveTextContent('Battery gauge');
  expect(panel).not.toHaveTextContent('Normal'); expect(panel).not.toHaveTextContent('Oil Level');
  expect(panel).not.toHaveTextContent('TPMS'); expect(service.readLatest).toHaveBeenCalledTimes(1);
}, 20000);

jest.mock('react-leaflet', () => {
  const React = require('react');
  return {
  Circle: () => null,
  MapContainer: React.forwardRef(({ children }, ref) => <div>{children}</div>),
  // Exercise the actual marker event handler without rendering hidden tooltips.
  Marker: React.forwardRef(function MockMarker({ eventHandlers, position, icon, children, zIndexOffset, interactive, title, riseOnHover, riseOffset }, ref) {
    const [hovered, setHovered] = React.useState(false);
    const root = React.useRef(null);
    React.useImperativeHandle(ref, () => ({ getElement: () => root.current }));
    const iconHtml = React.useMemo(() => <div dangerouslySetInnerHTML={{ __html: icon?.options?.html || '' }} />, [icon]);
    if (interactive === false) return <output data-testid="bus-gps-anchor" data-position={position.join(',')} data-icon-html={icon?.options?.html} data-marker-z-index={zIndexOffset} title={title} />;
    if (icon?.options?.sharedGroupBusIds) return <div ref={root} data-testid="shared-bus-marker" data-position={position.join(',')} data-marker-z-index={zIndexOffset} onClick={(event) => eventHandlers.click({ originalEvent: event.nativeEvent })}>
      {iconHtml}
      {children}
    </div>;
    const pinned = React.Children.toArray(children).some((child) => child.props.pinned);
    return <div ref={root} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button aria-label={`Marker ${position.join(',')}`} data-icon-size={icon?.options?.markerVisibleSize || icon?.options?.iconSize?.[0]} data-hit-target-size={icon?.options?.markerHitTargetSize || icon?.options?.iconSize?.[0]} data-marker-z-index={zIndexOffset} data-hover-rise={riseOnHover ? riseOffset : 0} data-icon-html={icon?.options?.html} onClick={eventHandlers.click} />
      {(hovered || pinned) && children}
    </div>;
  }),
  Polyline: ({ positions, interactive, pathOptions, smoothFactor, bubblingMouseEvents }) => (interactive === false
    ? <output data-testid={pathOptions.color === '#ffffff' ? 'bus-marker-connector-halo' : 'bus-marker-connector'} data-start={positions[0].join(',')} data-end={positions[positions.length - 1].join(',')} data-points={positions.length} data-smoothing={smoothFactor} data-bubbling={String(bubblingMouseEvents)} data-style={JSON.stringify(pathOptions)} />
    : <output data-testid="assigned-route-line" data-positions={JSON.stringify(positions)} />),
  TileLayer: () => null,
  Tooltip: React.forwardRef(({ children, className }, ref) => <div role="tooltip" data-pinned={Boolean(className?.includes('is-pinned'))}>{children}</div>),
  useMap: () => mockLeafletMap,
}; });

jest.mock('./supabase', () => {
  const createQuery = () => {
    const result = {
      data: [],
      error: null,
    };

    const query = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      order: jest.fn(() => query),
      limit: jest.fn(() => query),
      maybeSingle: jest.fn(() =>
        Promise.resolve({
          data: { bus_id: 'mock-bus' },
          error: null,
        })
      ),
      then: (resolve, reject) =>
        Promise.resolve(result).then(resolve, reject),
    };

    return query;
  };

  const channel = {
    on: jest.fn(() => channel),
    subscribe: jest.fn(() => channel),
  };

  return {
    supabase: {
      from: jest.fn(() => createQuery()),
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(),
      rpc: jest.fn(),
    },
    signOutActiveUser: jest.fn(),
  };
});

jest.mock('./AuthGate', () => function MockAuthGate({ renderLogin }) {
  return renderLogin({
    authenticationError: '',
    authorizationError: '',
    passwordResetError: '',
    passwordResetSuccess: '',
    signIn: jest.fn().mockResolvedValue(false),
    resetPassword: jest.fn().mockResolvedValue(false),
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLeafletMap.getZoom.mockReturnValue(12);
  // Map/selection unit tests must not open real OSRM sockets. Individual
  // routing tests can supply a response explicitly when they need one.
  jest.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
});

afterEach(() => { global.fetch.mockRestore(); });

test('renders the CentraBus administrator login', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /admin login/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /forgot password/i })).toBeInTheDocument();
});

test('retired TPMS data cannot generate vehicle conditions, attention items or application alerts', () => {
  const bus = { id: 'retired-only', status: 'active', tires: [{ position: 'Front Left', pressurePsi: 70, condition: 'Critical Low Pressure' }], overallTireStatus: 'Critical', lastTpmsUpdateMs: Date.now() };
  expect(hasValidatedConditionData(bus)).toBe(false);
  expect(getOverallVehicleCondition(bus)).toBe('No Data');
  expect(getNeedsAttentionIssues([bus])).toEqual([]);
  expect(buildApplicationAlerts([bus]).filter((alert) => alert.category === 'Vehicle Condition')).toEqual([]);
  expect(getFleetHealthCounts([bus])).toMatchObject({ critical: 0, warning: 0, unknown: 1 });
  render(<VehicleConditionSummary bus={bus} onNavigate={jest.fn()} />);
  expect(screen.getAllByText('Awaiting validated condition data').length).toBeGreaterThan(0);
  expect(screen.queryByText(/\btire\b|\btpms\b/i)).not.toBeInTheDocument();
});

test.each([
  { id: 'tire-bus-Front-Left' }, { issueKey: 'tire-summary-bus' },
  { type: 'TPMS' }, { eventType: 'LOW_TIRE_PRESSURE' }, { category: 'TirePressure' },
  { title: 'TPMS Sensor Offline' }, { title: 'Low tyre pressure' },
])('retired event identifiers are suppressed without relying on severity: %j', (event) => {
  expect(isRetiredTirePressureAlert(event)).toBe(true);
});

test('gauge air-pressure and GPS route alerts remain visible while obsolete alerts are excluded from counts/history/popups', () => {
  const bus = { id: 'bus', plateNumber: 'ABC 234', status: 'active' };
  const alerts = [
    { id: 'legacy-tpms', busId: 'bus', type: 'TPMS', title: 'Legacy sensor event', category: 'Vehicle Condition', severity: 'Critical', workflowStatus: 'New', timestampMs: 300 },
    { id: 'gauge', busId: 'bus', title: 'Front Air Pressure', category: 'Vehicle Condition', severity: 'Warning', workflowStatus: 'New', timestampMs: 200 },
    { id: 'route', busId: 'bus', title: 'Route Deviation Detected', category: 'Route', severity: 'Critical', workflowStatus: 'New', timestampMs: 100 },
  ];
  const counts = deriveMonitoringState([bus], alerts);
  expect(counts.alerts.map((item) => item.id)).toEqual(['gauge', 'route']);
  expect(counts).toMatchObject({ vehicleIssueCount: 1, criticalIssueCount: 0, warningIssueCount: 1 });
  const { result } = renderHook(() => useAlertNotification(alerts));
  expect(result.current.popupAlertId).toBe('gauge');
  render(<AlertsPage alerts={alerts} buses={[bus]} onUpdateAlert={jest.fn()} selectedAlertId="legacy-tpms" />);
  expect(screen.queryByText('Legacy sensor event')).not.toBeInTheDocument();
  expect(screen.getByText('Front Air Pressure')).toBeInTheDocument();
  expect(screen.getByText('Route Deviation Detected')).toBeInTheDocument();
});

test('obsolete TPMS popup is not rendered even if supplied directly', () => {
  const view = render(<AlertNotification alert={{ id: 'tire-1', title: 'Low Tire Pressure', severity: 'Critical' }} onDismiss={jest.fn()} />);
  expect(view.container).toBeEmptyDOMElement();
});

test('legacy preferences retain supported boolean values and discard retired/invalid keys', async () => {
  const legacy = { tirePressure: true, gaugePanel: false, routeDeviation: false, system: true, sound: false, unrelated: true };
  expect(normalizeNotificationPreferences(legacy)).toEqual({ gaugePanel: false, routeDeviation: false, system: true, sound: false });
  expect(normalizeNotificationPreferences({ gaugePanel: 'false' }).gaugePanel).toBe(true);
  const previous = localStorage.getItem('centrabus.notificationPreferences');
  localStorage.setItem('centrabus.notificationPreferences', JSON.stringify(legacy));
  try {
    render(<SettingsPage user={{ id: 'mock-admin', email: 'admin@example.test' }} onLogout={jest.fn()} buses={[]} busesStatus="ready" />);
    expect(screen.queryByRole('switch', { name: /tire|vehicle condition/i })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Gauge panel notifications' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Route deviation notifications' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('switch', { name: 'Gauge panel notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
    await screen.findByText('Notification preferences saved on this browser.');
    expect(JSON.parse(localStorage.getItem('centrabus.notificationPreferences'))).toEqual({ gaugePanel: true, routeDeviation: false, system: true, sound: false });
  } finally {
    if (previous === null) localStorage.removeItem('centrabus.notificationPreferences');
    else localStorage.setItem('centrabus.notificationPreferences', previous);
  }
});

test('derives fleet health without treating missing sensor data as normal', () => {
  const buses = [
    { id: 'normal', status: 'active', overallGaugeStatus: 'Normal' },
    { id: 'warning', status: 'inactive', gaugeReadings: [{ gaugeKey: 'fuel', status: 'Warning' }] },
    { id: 'critical', status: 'maintenance', gaugeReadings: [{ gaugeKey: 'oilPressure', status: 'Critical Low' }] },
    { id: 'unknown', status: 'offline' },
  ];

  expect(getOverallVehicleCondition(buses[3])).toBe('No Data');
  expect(getFleetHealthCounts(buses)).toEqual({
    total: 4,
    active: 1,
    inactive: 1,
    normal: 1,
    warning: 1,
    critical: 1,
    unknown: 1,
  });
});

test('prioritizes critical condition issues and limits the sidebar list', () => {
  const issues = getNeedsAttentionIssues([
    {
      id: 'bus-1',
      plateNumber: 'ABC 234',
      gaugeReadings: [
        { id: 'normal', gaugeKey: 'coolant', label: 'Water Temperature', status: 'Normal', analyzedAt: 400 },
        { id: 'fuel', gaugeKey: 'fuel', label: 'Fuel Level', status: 'Warning', estimatedPercent: 25, analyzedAt: 300 },
        { id: 'air', gaugeKey: 'frontAir', label: 'Front Air Pressure', status: 'Warning', numericValue: 4, analyzedAt: 200 },
        { id: 'oil', gaugeKey: 'oilPressure', label: 'Oil Level', status: 'Low', rangeState: 'Low', analyzedAt: 100 },
        { id: 'critical', gaugeKey: 'rearAir', label: 'Rear Air Pressure', status: 'Critical Low Pressure', numericValue: 2, analyzedAt: 100 },
      ],
    },
  ]);

  expect(issues).toHaveLength(3);
  expect(issues[0]).toMatchObject({ severity: 'Critical', plateNumber: 'ABC 234' });
  expect(issues.some((issue) => issue.label === 'Water Temperature')).toBe(false);
});

test('surfaces an overall live condition when detailed readings are unavailable', () => {
  expect(getNeedsAttentionIssues([{ id: 'bus-2', plateNumber: 'CRK 160', overallGaugeStatus: 'Warning' }])).toEqual([
    expect.objectContaining({ plateNumber: 'CRK 160', severity: 'Warning', label: 'Gauge Panel Condition', reading: 'Warning' }),
  ]);
});

test('normalizes plate numbers and rejects spacing or case variants of registered plates', () => {
  expect(normalizePlateNumber('  abc   234  ')).toBe('ABC 234');
  expect(isValidPlateNumber('ABC-234')).toBe(true);
  expect(isValidPlateNumber('ABC/234')).toBe(false);
  expect(hasRegisteredDuplicatePlate([
    { id: 'registered', plateNumber: 'ABC 234', isPlaceholder: false },
    { id: 'archived', plateNumber: 'OLD 100', isArchived: true },
  ], ' abc234 ')).toBe(true);
  expect(hasRegisteredDuplicatePlate([
    { id: 'archived', plateNumber: 'OLD 100', isArchived: true },
  ], 'OLD100')).toBe(false);
  expect(hasRegisteredDuplicatePlate([
    { id: 'editing-bus', plateNumber: 'ABC 234', isPlaceholder: false },
  ], 'ABC234', 'editing-bus')).toBe(false);
});

test('builds alerts only from current bus condition, real confirmed route state, and explicit GPS-offline state', () => {
  const alerts = buildApplicationAlerts([
    {
      id: 'bus-live',
      plateNumber: 'ABC 234',
      routeName: 'LIMA–FPIP',
      updatedAt: 900,
      gps: { online: false, updatedAt: 1000, routeStatus: 'CONFIRMED DEVIATION', distanceFromRouteM: 10460 },
      gaugeReadings: [
        { id: 'fuel', gaugeKey: 'fuel', label: 'Fuel Level', status: 'Warning', estimatedPercent: 25, analyzedAt: 1100 },
        { id: 'normal', gaugeKey: 'coolant', label: 'Water Temperature', status: 'Normal', analyzedAt: 1200 },
      ],
    },
  ], 2000);

  expect(alerts).toHaveLength(3);
  expect(alerts.map((alert) => alert.category).sort()).toEqual(['Connectivity', 'Route', 'Vehicle Condition']);
  expect(alerts.some((alert) => alert.title === 'Water Temperature')).toBe(false);
  expect(alerts.every((alert) => alert.busNumber === 'bus-live')).toBe(true);
  expect(alerts.find((alert) => alert.category === 'Route')).toMatchObject({
    id: 'route-deviation-bus-live',
    severity: 'Critical',
    description: '10.46 km from assigned route.',
    timestampMs: 1000,
  });
});

test('does not generate sample alerts for a newly registered bus without telemetry', () => {
  expect(buildApplicationAlerts([
    { id: 'new-bus', plateNumber: 'NEW 001', status: 'inactive', isPlaceholder: false },
  ])).toEqual([]);
});

test('normalizes registered buses without inventing vehicle-condition data or GPS positions', () => {
  const buses = normalizeOperationalBuses([
    { id: 'supabase-bus-1', plateNumber: 'ABC 234', status: 'active' },
    { id: 'supabase-bus-2', plateNumber: 'CRK 160', status: 'inactive' },
  ]);

  expect(buses.map((bus) => bus.id)).toEqual(['supabase-bus-1', 'supabase-bus-2']);
  expect(buses.every((bus) => bus.gaugeReadings === undefined && bus.tires === undefined)).toBe(true);
  expect(buses.every((bus) => bus.overallGaugeStatus === undefined && bus.overallTireStatus === undefined)).toBe(true);
  expect(buses.every((bus) => bus.lastGaugeAnalysisMs === undefined && bus.lastTpmsUpdateMs === undefined)).toBe(true);
  expect(buses[1].routeStatus).toBe('Route Deviation');
  expect(buses.every((bus) => bus.gps === undefined)).toBe(true);
});

test('suppresses explicitly marked sample condition data without suppressing GPS alerts', () => {
  const [bus] = normalizeOperationalBuses([
    {
      id: 'only-supabase-bus',
      plateNumber: 'ABC 234',
      status: 'active',
      usesInitialSampleTelemetry: true,
      gaugeReadings: [{ id: 'sample-fuel', label: 'Fuel Level', estimatedPercent: 25, status: 'Warning' }],
      overallGaugeStatus: 'Warning',
      lastGaugeAnalysisMs: 1234,
      tires: [{ position: 'Rear Left', pressurePsi: 88, condition: 'Critical Low Pressure' }],
      overallTireStatus: 'Critical',
      lastTpmsUpdateMs: 1234,
      gps: { online: false, updatedAt: 2000 },
    },
  ]);
  const alerts = buildApplicationAlerts([bus]);
  const sampleAlert = { id: 'sample-condition', busId: bus.id, category: 'Vehicle Condition', severity: 'Critical', title: 'Rear Left Pressure', workflowStatus: 'New' };
  const counts = deriveMonitoringState([bus], [...alerts, sampleAlert]);

  expect(bus.gaugeReadings).toEqual([]);
  expect(bus.overallGaugeStatus).toBeUndefined();
  expect(getOverallVehicleCondition(bus)).toBe('No Data');
  expect(hasValidatedConditionData(bus)).toBe(false);
  expect(getNeedsAttentionIssues([bus])).toEqual([]);
  expect(bus.routeStatus).toBe('Route Deviation');
  expect(alerts.map((alert) => alert.category)).toEqual(['Connectivity']);
  expect(counts.vehicleIssueCount).toBe(0);
  expect(counts.alerts.map((alert) => alert.category)).toEqual(['Connectivity']);
  expect(alerts.some((alert) => alert.category === 'Route')).toBe(false);
  const { result } = renderHook(() => useAlertNotification(alerts));
  expect(result.current.popupAlertId).toBe('gps-offline-only-supabase-bus');
  render(<AlertsPage alerts={counts.alerts} buses={[bus]} onUpdateAlert={jest.fn()} initialCategory="Vehicle Condition" initialStatus="active" />);
  expect(screen.queryByText('Rear Left Pressure')).not.toBeInTheDocument();
});

test('keeps real gauge telemetry while leaving opaque retired data unchanged and unused', () => {
  const realGauge = { id: 'real-gauge', gaugeKey: 'fuel', status: 'Critical' };
  const realTire = { position: 'Front Left', condition: 'Warning' };
  const [bus] = normalizeOperationalBuses([{
    id: 'real-bus',
    gaugeReadings: [realGauge],
    tires: [realTire],
    overallGaugeStatus: 'Critical',
    overallTireStatus: 'Warning',
  }]);

  expect(bus.gaugeReadings).toEqual([realGauge]);
  expect(bus.tires).toEqual([realTire]);
  expect(bus.overallGaugeStatus).toBe('Critical');
  expect(hasValidatedConditionData(bus)).toBe(true);
  expect(getNeedsAttentionIssues([bus]).map((issue) => issue.severity)).toContain('Critical');
});

test('condition panels show awaiting-data state instead of fake normal values', () => {
  const bus = { id: 'awaiting-bus', plateNumber: 'ABC 234', status: 'active' };
  render(<VehicleConditionSummary bus={bus} onNavigate={jest.fn()} />);
  expect(screen.getAllByText('Awaiting validated condition data').length).toBeGreaterThan(0);
  expect(screen.queryByText('No active issues')).not.toBeInTheDocument();
  expect(screen.queryByText('0 of 0')).not.toBeInTheDocument();
  expect(screen.queryByText('Gauges Normal')).not.toBeInTheDocument();
  expect(screen.queryByText('Estimated 75%')).not.toBeInTheDocument();
});

test('dashboard condition overview hides explicitly marked sample values', () => {
  render(<VehicleConditionOverview bus={{
    id: 'sample-bus',
    usesInitialSampleTelemetry: true,
    gaugeReadings: [{ id: 'fake-fuel', label: 'Fuel Level', estimatedPercent: 75, status: 'Normal' }],
    overallGaugeStatus: 'Normal',
  }} onNavigate={jest.fn()} />);
  expect(screen.getAllByText('Awaiting validated condition data').length).toBeGreaterThan(0);
  expect(screen.queryByText('Fuel Level')).not.toBeInTheDocument();
  expect(screen.queryByText('75%')).not.toBeInTheDocument();
  expect(screen.queryByText('Normal')).not.toBeInTheDocument();
});

test('vehicle condition fleet cards do not call missing readings normal or stable', () => {
  const buses = [{ id: 'awaiting-bus', plateNumber: 'ABC 234', status: 'active' }];
  render(
    <>
      <FleetHealthCard buses={buses} fleetStatus="ready" />
      <NeedsAttentionCard buses={buses} fleetStatus="ready" onNavigate={jest.fn()} />
    </>,
  );
  expect(screen.getByText('Awaiting Data')).toBeInTheDocument();
  expect(screen.getByText('Awaiting validated condition data')).toBeInTheDocument();
  expect(screen.queryByText('All monitored vehicles are stable.')).not.toBeInTheDocument();
});

test('overview KPI labels missing condition coverage instead of implying a clean fleet', () => {
  const counts = deriveMonitoringState([{ id: 'awaiting-bus', status: 'active' }], []);
  render(<SummaryCards counts={counts} busesLoading={false} onNavigate={jest.fn()} />);
  const vehicleIssues = screen.getByRole('button', { name: /Vehicle Issues/ });
  expect(within(vehicleIssues).getByText('Awaiting validated condition data')).toBeInTheDocument();
  expect(vehicleIssues.querySelector('.summary-card-icon')).toHaveTextContent('');
  expect(vehicleIssues.querySelector('.summary-card-icon span')).toHaveClass('bg-slate-50');
});

test('keeps selection tied to a stable bus ID and clears it only when that bus is removed', () => {
  const buses = [{ id: 'remaining-bus' }, { id: 'another-bus' }];
  expect(getValidSelectedBusId(buses, null)).toBeNull();
  expect(getValidSelectedBusId(buses, 'deleted-bus')).toBeNull();
  expect(getValidSelectedBusId(buses, 'another-bus')).toBe('another-bus');
  expect(getValidSelectedBusId([...buses].reverse(), 'another-bus')).toBe('another-bus');
  expect(getValidSelectedBusId([], 'deleted-bus')).toBeNull();
});

const overviewBuses = [
  { id: 'bus-a', plateNumber: 'ABC 234', status: 'active', routeName: 'Route A', gps: { latitude: 14.095, longitude: 121.16, speed: 35, rawSpeedKmh: 35, online: true, updatedAt: 100000, routeStatus: 'ON ROUTE', distanceFromRouteM: 28 }, gaugeReadings: [{ gaugeKey: 'fuel', label: 'Fuel Level', status: 'Warning', estimatedPercent: 25 }, { gaugeKey: 'coolant', label: 'Water Temperature', status: 'Normal' }] },
  { id: 'bus-b', plateNumber: 'CRK 160', status: 'inactive', routeName: 'Route B', gps: { latitude: 14.1, longitude: 121.17, speed: 0, online: true, updatedAt: 100000, routeStatus: 'POSSIBLE DEVIATION', distanceFromRouteM: 10460 }, gaugeReadings: [{ gaugeKey: 'fuel', label: 'Fuel Level', status: 'Normal' }] },
];
const overviewTrips = overviewBuses.map((bus) => ({ busId: bus.id }));

const overviewKpiCounts = {
  activeBusCount: 2,
  vehicleIssueCount: 6,
  warningIssueCount: 5,
  criticalIssueCount: 1,
  activeRouteDeviationCount: 1,
};

function OverviewHarness({
  buses = overviewBuses,
  onNavigate = jest.fn(),
  includeKpis = false,
  kpiCounts = overviewKpiCounts,
  includeGpsDiagnosticsForTest = true,
}) {
  const [selectedBusId, setSelectedBusId] = useState(null);
  return <>
    {includeKpis && <SummaryCards counts={kpiCounts} busesLoading={false} onNavigate={onNavigate} />}
    <MonitoringOverviewFleet buses={buses} trips={overviewTrips} selectedBusId={selectedBusId} onSelectBusId={setSelectedBusId} onNavigate={onNavigate} nowMs={105000} includeGpsDiagnosticsForTest={includeGpsDiagnosticsForTest} />
  </>;
}

test.each([
  ['ON ROUTE', 'On Route', 'success'],
  ['OUTSIDE CHECK 1/3', 'Outside Check 1/3', 'caution'],
  ['OUTSIDE CHECK 2/3', 'Outside Check 2/3', 'caution'],
  ['POSSIBLE DEVIATION', 'Possible Deviation', 'warning'],
  ['CONFIRMED DEVIATION', 'Confirmed Deviation', 'critical'],
])('formats route-monitoring status %s with the correct semantic tone', (rawStatus, label, tone) => {
  expect(getRouteStatusPresentation(rawStatus)).toMatchObject({ label, tone });
});

test('counts only unique buses with real confirmed Supabase route deviations', () => {
  const routeFleet = [
    { id: 'on-route', gps: { routeStatus: 'ON ROUTE' } },
    { id: 'check-1', gps: { routeStatus: 'OUTSIDE CHECK 1/3' } },
    { id: 'check-2', gps: { routeStatus: 'OUTSIDE CHECK 2/3' } },
    { id: 'possible', gps: { routeStatus: 'POSSIBLE DEVIATION' } },
    { id: 'confirmed-a', gps: { routeStatus: 'CONFIRMED DEVIATION' } },
    { id: 'confirmed-b', gps: { routeStatus: 'CONFIRMED DEVIATION' } },
  ];

  expect(routeFleet.map(isConfirmedRouteDeviation)).toEqual([false, false, false, false, true, true]);
  expect(deriveMonitoringState(routeFleet, buildApplicationAlerts(routeFleet))).toMatchObject({ activeRouteDeviationCount: 2 });
});

test('real route alert has a stable identity, does not duplicate, and clears on return to route', () => {
  const confirmedBus = {
    id: 'bus-route-alert',
    plateNumber: 'ABC 234',
    routeName: 'LIMA–FPIP',
    gps: { routeStatus: 'CONFIRMED DEVIATION', distanceFromRouteM: 10460, updatedAt: 1000 },
  };
  const firstAlert = buildApplicationAlerts([confirmedBus]).filter((alert) => alert.category === 'Route');
  const updatedAlert = buildApplicationAlerts([{ ...confirmedBus, gps: { ...confirmedBus.gps, distanceFromRouteM: 10470, updatedAt: 2000 } }]).filter((alert) => alert.category === 'Route');
  const combinedState = deriveMonitoringState([confirmedBus], [...firstAlert, ...updatedAlert]);

  expect(firstAlert).toHaveLength(1);
  expect(updatedAlert).toHaveLength(1);
  expect(updatedAlert[0].id).toBe(firstAlert[0].id);
  expect(combinedState.activeAlerts.filter((alert) => alert.category === 'Route')).toHaveLength(1);
  expect(buildApplicationAlerts([{ ...confirmedBus, gps: { ...confirmedBus.gps, routeStatus: 'ON ROUTE', updatedAt: 3000 } }]).filter((alert) => alert.category === 'Route')).toEqual([]);
  expect(buildApplicationAlerts([{ ...confirmedBus, gps: { ...confirmedBus.gps, routeStatus: 'POSSIBLE DEVIATION' } }]).filter((alert) => alert.category === 'Route')).toEqual([]);
});

test('formats route distance in meters or kilometers and handles missing values', () => {
  expect(formatDistanceFromRoute(28)).toBe('28 m');
  expect(formatDistanceFromRoute(10460)).toBe('10.46 km');
  expect(formatDistanceFromRoute(undefined)).toBe('Unavailable');
  expect(formatDistanceFromRoute('invalid')).toBe('Unavailable');
});

test('preserves route-monitoring and health timestamps when normalizing a Supabase GPS record', () => {
  expect(normalizeLiveGpsRecord({
    latitude: 14.095,
    longitude: 121.16,
    speed: 35,
    rawSpeedKmh: 35,
    online: true,
    updatedAt: 100000,
    gpsUpdatedAt: 100000,
    deviceUpdatedAt: 105000,
    routeStatus: 'CONFIRMED DEVIATION',
    distanceFromRouteM: 1234,
  })).toEqual({
    latitude: 14.095,
    longitude: 121.16,
    speed: 35,
    rawSpeedKmh: 35,
    motionStatus: 'UNKNOWN',
    online: true,
    updatedAt: 100000,
    gpsUpdatedAt: 100000,
    deviceUpdatedAt: 105000,
    routeStatus: 'CONFIRMED DEVIATION',
    distanceFromRouteM: 1234,
  });
});

test('builds Activity Records from live GPS snapshots and ignores unavailable gauge data', () => {
  const buses = [{ id: 'bus-a', plateNumber: 'ABC 234', status: 'active' }];
  const history = appendLiveGpsHistory({}, {
    'bus-a': normalizeLiveGpsRecord({ latitude: 14.095, longitude: 121.16, speed: 35, rawSpeedKmh: 35, online: true, updatedAt: 100000 }),
  });
  const records = buildLiveGpsActivityRecords(buses, history, 100500);

  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    busNumber: 'bus-a',
    category: 'GPS',
    latitude: 14.095,
    longitude: 121.16,
    speed: 35,
    gpsStatus: 'Online',
    online: true,
    sync: 'Synced',
  });
  expect(records[0].event).toContain('14.095000, 121.160000');
  expect(records.some((record) => record.category === 'Gauge Panel')).toBe(false);
});

test('retains distinct GPS snapshots and exports explicit GPS fields', () => {
  const first = normalizeLiveGpsRecord({ latitude: 14.095, longitude: 121.16, speed: 35, rawSpeedKmh: 35, online: true, updatedAt: 100000 });
  const second = normalizeLiveGpsRecord({ latitude: 14.0951, longitude: 121.1601, speed: 37, rawSpeedKmh: 37, online: true, updatedAt: 101000 });
  const history = appendLiveGpsHistory(appendLiveGpsHistory({}, { 'bus-a': first }), { 'bus-a': second });
  const records = buildLiveGpsActivityRecords([{ id: 'bus-a', plateNumber: 'ABC 234', status: 'active' }], history, 101500);
  const csv = buildActivityRecordsCsv(records, [{ id: 'bus-a', plateNumber: 'ABC 234', status: 'active' }]);

  expect(records).toHaveLength(2);
  expect(csv).toContain('Latitude');
  expect(csv).toContain('Longitude');
  expect(csv).toContain('Speed (km/h)');
  expect(csv).toContain('GPS Status');
  expect(csv).toContain('14.0951');
  expect(csv).toContain('37');
  expect(csv).not.toContain('Gauge Panel');
});

test('normalizes persisted Supabase GPS history and merges it with live samples', () => {
  const persisted = normalizePersistedGpsRecord({
    latitude: 14.0952,
    longitude: 121.1602,
    speed: 38,
    rawSpeedKmh: 38,
    online: true,
    receivedAt: 102000,
  });
  const merged = mergeLiveGpsHistory(
    appendLiveGpsHistory({}, {
      'bus-a': normalizeLiveGpsRecord({ latitude: 14.095, longitude: 121.16, speed: 35, online: true, updatedAt: 101000 }),
    }),
    { 'bus-a': [persisted] },
  );

  expect(getGpsSampleTimestamp(persisted)).toBe(102000);
  expect(merged['bus-a']).toHaveLength(2);
  expect(merged['bus-a'][1]).toMatchObject({ latitude: 14.0952, longitude: 121.1602, speed: 38 });
});

test('prefers gpsUpdatedAt for GPS freshness and keeps updatedAt fallback compatibility', () => {
  const nowMs = 100000;
  expect(getGpsFreshness({ gps: { online: true, gpsUpdatedAt: 80000, updatedAt: 1000 } }, nowMs).status).toBe('Online');
  expect(getGpsFreshness({ gps: { online: true, updatedAt: 80000 } }, nowMs).status).toBe('Online');
  expect(getGpsFreshness({ gps: { online: true, updatedAt: 60000 } }, nowMs).status).toBe('Delayed');
  expect(getGpsFreshness({ gps: { online: true, updatedAt: 30000 } }, nowMs).status).toBe('Stale');
  expect(getGpsFreshness({ gps: { online: false, updatedAt: 99000 } }, nowMs).status).toBe('Offline');
  expect(getGpsFreshness({ gps: { online: true } }, nowMs).status).toBe('Unknown');
  const supabaseTimestamp = '2026-10-02T09:16:20.000Z';
  const supabaseNowMs = Date.parse('2026-10-02T09:16:30.000Z');
  expect(getGpsSampleTimestamp({ gpsUpdatedAt: supabaseTimestamp })).toBe(Date.parse(supabaseTimestamp));
  expect(getGpsFreshness({ gps: { online: true, gpsUpdatedAt: supabaseTimestamp } }, supabaseNowMs).status).toBe('Online');
});

const healthyBackendPoll = (nowMs, lastTelemetryReceivedAt = nowMs - 1_000) => ({
  data: { lastTelemetryReceivedAt },
  lastSuccessAt: nowMs - 300,
  consecutiveFailures: 0,
  hasAttempted: true,
});

function systemHealthAt(nowMs, overrides = {}) {
  return deriveSystemHealth({
    nowMs,
    gpsByBusId: {
      'bus-a': {
        latitude: 14.095,
        longitude: 121.16,
        speed: 0,
        gpsUpdatedAt: nowMs - 800,
        updatedAt: nowMs - 800,
        deviceUpdatedAt: nowMs - 600,
      },
    },
    backendPoll: healthyBackendPoll(nowMs),
    realtime: { channelStatus: 'SUBSCRIBED', changedAt: nowMs - 500, readStatus: 'READY' },
    ...overrides,
  });
}

test('system health reports every healthy stationary signal as live', () => {
  const nowMs = 100_000;
  const health = systemHealthAt(nowMs);

  expect(health.gps.status).toBe('LIVE');
  expect(health.raspberryPi.status).toBe('ONLINE');
  expect(health.backend.status).toBe('ONLINE');
  expect(health.realtime.status).toBe('LIVE');
  expect(health.overall.label).toBe('ALL SYSTEMS LIVE');
  render(<SystemHealthCard health={health} nowMs={nowMs} />);
  expect(screen.getByRole('region', { name: 'System Health' })).toHaveTextContent('ALL SYSTEMS LIVE');
  expect(screen.getByText('GPS Device Activity').getAttribute('title')).toContain('does not confirm that every bus device is online');
  expect(screen.getByRole('region', { name: 'System Health' })).toHaveTextContent('Latest packet from any device');
});

test('system health accepts Supabase ISO GPS timestamps', () => {
  const nowMs = Date.parse('2026-10-02T09:16:30.000Z');

  const health = deriveSystemHealth({
    nowMs,
    gpsByBusId: {
      'bus-a': {
        latitude: 13.97767,
        longitude: 121.16798,
        speed: 0,
        gpsUpdatedAt: '2026-10-02T09:16:29.000Z',
        updatedAt: '2026-10-02T09:16:29.000Z',
        deviceUpdatedAt: '2026-10-02T09:16:29.000Z',
      },
    },
    backendPoll: healthyBackendPoll(nowMs),
    realtime: { channelStatus: 'SUBSCRIBED', changedAt: nowMs - 500, readStatus: 'READY' },
  });

  expect(health.gps.status).toBe('LIVE');
  expect(health.realtime.status).toBe('LIVE');
  expect(health.overall.label).toBe('ALL SYSTEMS LIVE');
});

test('future GPS timestamps beyond bounded skew are never confirmed Online or LIVE', () => {
  const nowMs = 100000;
  expect(getGpsFreshness({ gps: { gpsUpdatedAt: nowMs + 2000 } }, nowMs).status).toBe('Online');
  expect(getGpsFreshness({ gps: { gpsUpdatedAt: nowMs + 2001 } }, nowMs)).toMatchObject({
    status: 'Unknown', ageMs: null, updatedAtMs: null, reason: 'future-timestamp',
  });
  expect(getGpsFreshness({ gps: { online: false, gpsUpdatedAt: nowMs + 30000 } }, nowMs).status).toBe('Unknown');
  const health = systemHealthAt(nowMs, { gpsByBusId: { 'bus-a': { gpsUpdatedAt: nowMs + 30000 } } });
  expect(health.gps.status).toBe('NO DATA');
  expect(health.gps.timestampMs).toBeNull();
});

test('a future-dated bus does not mask a valid bus in system GPS health', () => {
  const nowMs = 100000;
  const health = systemHealthAt(nowMs, { gpsByBusId: {
    'bus-a': { gpsUpdatedAt: nowMs + 30000 },
    'bus-b': { gpsUpdatedAt: nowMs - 1000 },
  } });
  expect(health.gps.status).toBe('LIVE');
  expect(health.gps.timestampMs).toBe(nowMs - 1000);
});

test('freshness age boundaries and missing/offline behavior remain unchanged', () => {
  const nowMs = 100000;
  expect(getGpsFreshness({ gps: { gpsUpdatedAt: nowMs - 30000 } }, nowMs).status).toBe('Online');
  expect(getGpsFreshness({ gps: { gpsUpdatedAt: nowMs - 30001 } }, nowMs).status).toBe('Delayed');
  expect(getGpsFreshness({ gps: { gpsUpdatedAt: nowMs - 60000 } }, nowMs).status).toBe('Delayed');
  expect(getGpsFreshness({ gps: { gpsUpdatedAt: nowMs - 60001 } }, nowMs).status).toBe('Stale');
  expect(getGpsFreshness({ gps: { online: false } }, nowMs).status).toBe('Offline');
});

test('system health separates stale GPS from a healthy sender heartbeat', () => {
  const nowMs = 100_000;
  const health = systemHealthAt(nowMs, {
    gpsByBusId: {
      'bus-a': { gpsUpdatedAt: nowMs - 45_000, updatedAt: nowMs - 45_000, deviceUpdatedAt: nowMs - 1_000 },
    },
  });

  expect(health.gps.status).toBe('STALE');
  expect(health.raspberryPi.status).toBe('ONLINE');
  expect(health.realtime.status).toBe('LIVE');
  expect(health.overall.label).toBe('GPS DATA STALE');
});

test('system health uses packet receipt for device reachability without treating it as fresh GPS', () => {
  const nowMs = 100_000;
  const health = systemHealthAt(nowMs, {
    gpsByBusId: {
      'bus-a': {
        gpsUpdatedAt: nowMs - 65_000,
        updatedAt: nowMs - 1_000,
        deviceUpdatedAt: nowMs - 1_000,
      },
    },
    backendPoll: {
      data: {
        lastPacketReceivedAt: nowMs - 1_000,
        lastFreshTelemetryAt: nowMs - 65_000,
        lastTelemetryReceivedAt: nowMs - 65_000,
      },
      lastSuccessAt: nowMs - 300,
      consecutiveFailures: 0,
      hasAttempted: true,
    },
  });

  expect(health.raspberryPi.status).toBe('ONLINE');
  expect(health.gps.status).toBe('STALE');
  expect(health.overall.label).toBe('GPS DATA STALE');
});

test('system health reports a stopped sender without blaming the backend', () => {
  const nowMs = 100_000;
  const health = systemHealthAt(nowMs, {
    gpsByBusId: {
      'bus-a': { gpsUpdatedAt: nowMs - 45_000, updatedAt: nowMs - 45_000, deviceUpdatedAt: nowMs - 25_000 },
    },
    backendPoll: healthyBackendPoll(nowMs, nowMs - 25_000),
    realtime: { channelStatus: 'SUBSCRIBED', changedAt: nowMs - 25_000, readStatus: 'READY' },
  });

  expect(health.backend.status).toBe('ONLINE');
  expect(health.raspberryPi.status).toBe('OFFLINE');
  expect(health.gps.status).toBe('STALE');
  expect(health.realtime.status).toBe('LIVE');
  expect(health.overall.label).toBe('NO GPS DEVICE PACKETS');
});

test('system health marks Pi unknown when backend is unreachable', () => {
  const nowMs = 100_000;
  const health = systemHealthAt(nowMs, {
    backendPoll: {
      ...healthyBackendPoll(nowMs),
      lastSuccessAt: nowMs - 20_000,
      consecutiveFailures: 2,
    },
  });

  expect(health.backend.status).toBe('OFFLINE');
  expect(health.raspberryPi.status).toBe('UNKNOWN');
  expect(health.overall.label).toBe('BACKEND UNREACHABLE');
});

test('unconfigured production backend is explicit and cannot claim verified device reachability', () => {
  const health = systemHealthAt(100_000, { backendPoll: {
    ...healthyBackendPoll(100_000), configured: false,
  } });
  expect(health.backend.status).toBe('NOT CONFIGURED');
  expect(health.raspberryPi.status).toBe('UNKNOWN');
  expect(health.overall.label).toBe('BACKEND NOT CONFIGURED');
  render(<SystemHealthCard health={health} nowMs={100_000} />);
  expect(screen.getByText('The approved HTTPS backend URL has not been configured.')).toBeInTheDocument();
});

test('one initial backend polling failure is degraded rather than immediately offline', () => {
  expect(deriveBackendHealthStatus({
    data: null,
    lastSuccessAt: null,
    consecutiveFailures: 1,
    hasAttempted: true,
  }, 100_000).status).toBe('DEGRADED');
});

test('header connectivity reports dashboard internet access separately from stale bus GPS', () => {
  const nowMs = 100_000;
  const health = systemHealthAt(nowMs, {
    gpsByBusId: { 'bus-a': { gpsUpdatedAt: nowMs - 45_000, updatedAt: nowMs - 45_000, deviceUpdatedAt: nowMs - 1_000 } },
  });

  expect(health.gps.status).toBe('STALE');
  expect(health.backend.status).toBe('ONLINE');
  expect(deriveDashboardConnectivityStatus(health.backend)).toMatchObject({
    label: 'Internet connected',
    tone: 'healthy',
  });
});

test.each([
  ['DEGRADED', 'Internet connection unstable', 'degraded'],
  ['OFFLINE', 'Cloud unreachable', 'offline'],
  ['NOT CONFIGURED', 'Backend not configured', 'neutral'],
  ['CHECKING', 'Checking internet', 'neutral'],
])('dashboard connectivity presents backend status %s accurately', (status, label, tone) => {
  expect(deriveDashboardConnectivityStatus({ status })).toMatchObject({ label, tone });
});

test('system health shows a channel error separately from fresh GPS and a healthy backend', () => {
  const health = systemHealthAt(100_000, { realtime: { channelStatus: 'CHANNEL_ERROR', changedAt: 99_000 } });
  expect(health.realtime.status).toBe('CHANNEL_ERROR');
  expect(health.gps.status).toBe('LIVE');
  expect(health.backend.status).toBe('ONLINE');
  expect(health.overall.label).toBe('DATA STREAM UNAVAILABLE');
});

test.each(['PENDING', 'CONNECTING'])('realtime %s is connecting without inventing a fresh update', (channelStatus) => {
  const signal = deriveRealtimeHealth({ channelStatus }, 100_000);
  expect(signal.status).toBe('CONNECTING');
  expect(signal.timestampMs).toBeNull();
  expect(signal.lastEventAt).toBeNull();
});

test.each(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])('realtime %s is explicit and unavailable in System Health', (channelStatus) => {
  const health = systemHealthAt(100_000, { realtime: { channelStatus, changedAt: 99_000 } });
  expect(health.realtime.status).toBe(channelStatus);
  expect(health.overall.label).toBe('DATA STREAM UNAVAILABLE');
  render(<SystemHealthCard health={health} nowMs={100_000} />);
  const card = screen.getByRole('region', { name: 'System Health' });
  expect(card).toHaveTextContent('Supabase Realtime');
  expect(card).toHaveTextContent(channelStatus);
  expect(card).not.toHaveTextContent('Firebase');
});

test('an idle subscribed channel stays live without making stale GPS fresh', () => {
  const health = systemHealthAt(100_000, {
    gpsByBusId: { 'bus-a': { gpsUpdatedAt: 55_000, deviceUpdatedAt: 55_000 } },
    realtime: { channelStatus: 'SUBSCRIBED', changedAt: 1_000, readStatus: 'READY' },
  });
  expect(health.realtime.status).toBe('LIVE');
  expect(health.gps.status).toBe('STALE');
  expect(health.overall.label).toBe('GPS DATA STALE');
});

test('backend offline takes precedence even when the Realtime channel is subscribed', () => {
  const health = systemHealthAt(100_000, {
    backendPoll: { ...healthyBackendPoll(100_000), consecutiveFailures: 2 },
  });
  expect(health.realtime.status).toBe('LIVE');
  expect(health.backend.status).toBe('OFFLINE');
  expect(health.raspberryPi.status).toBe('UNKNOWN');
  expect(health.overall.label).toBe('BACKEND UNREACHABLE');
});

test('subscribed Realtime does not prove initial GPS read permissions', () => {
  const health = systemHealthAt(100_000, {
    realtime: { channelStatus: 'SUBSCRIBED', changedAt: 99_000, readStatus: 'ERROR' },
  });
  expect(health.realtime.status).toBe('LIVE');
  expect(health.overall.label).toBe('GPS DATA READ FAILED');
  render(<SystemHealthCard health={health} nowMs={100_000} />);
  expect(screen.getByRole('region', { name: 'System Health' })).toHaveTextContent('initial read failed');
});

test('initial health and an unknown channel status remain checking rather than falsely live', () => {
  const initial = deriveSystemHealth({ nowMs: 100_000 });
  expect(initial.backend.status).toBe('CHECKING');
  expect(initial.realtime.status).toBe('CONNECTING');
  expect(initial.gps.status).toBe('NO DATA');
  expect(deriveRealtimeHealth({ channelStatus: 'UNEXPECTED' }, 100_000).status).toBe('UNKNOWN');
  expect(systemHealthAt(100_000, { realtime: {} }).overall.label).toBe('CHECKING SYSTEM HEALTH');
});

test('backend process restart with no telemetry timestamp remains safe', () => {
  const nowMs = 100_000;
  const health = systemHealthAt(nowMs, { backendPoll: healthyBackendPoll(nowMs, null) });
  expect(health.backend.status).toBe('ONLINE');
  expect(health.raspberryPi.status).toBe('UNKNOWN');
  expect(health.overall.label).toBe('CHECKING SYSTEM HEALTH');
});

test('heartbeat-only Supabase updates do not create speed graph samples', () => {
  const initialGps = { gpsUpdatedAt: 100_000, updatedAt: 100_000, deviceUpdatedAt: 100_000, speed: 0, rawSpeedKmh: 0 };
  const heartbeatOnly = { ...initialGps, deviceUpdatedAt: 105_000 };
  const initialHistory = appendGpsSpeedSample([], initialGps);
  const afterHeartbeat = appendGpsSpeedSample(initialHistory, heartbeatOnly);

  expect(getGpsSampleTimestamp(heartbeatOnly)).toBe(100_000);
  expect(afterHeartbeat).toEqual(initialHistory);
  expect(afterHeartbeat).toHaveLength(1);
});

test('bus details labels bus-record metadata separately from GPS and handles missing route data', () => {
  render(<BusDetailsPanel
    bus={{ id: 'bus-no-route-data', plateNumber: 'ABC 234', status: 'active', routeName: 'Route A', updatedAt: 100000, gps: { latitude: 14.095, longitude: 121.16, speed: 0, online: true, updatedAt: 100000 } }}
    onNavigate={jest.fn()}
    nowMs={105000}
  />);
  expect(screen.getByText(/Bus Record Updated:/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Route Monitoring' })).toBeInTheDocument();
  expect(screen.getAllByText('Unavailable')).toHaveLength(2);
});

test('map marker card displays real route data and separates GPS time from bus metadata time', () => {
  const bus = {
    id: 'map-popup-bus',
    plateNumber: 'ABC 234',
    status: 'active',
    routeName: 'LIMA–FPIP',
    updatedAt: 90000,
    gps: { latitude: 14.095, longitude: 121.16, speed: 0, rawSpeedKmh: 0.59, online: true, updatedAt: 100000, routeStatus: 'CONFIRMED DEVIATION', distanceFromRouteM: 10460 },
  };
  const { rerender } = render(<BusMarkerCallout bus={bus} nowMs={105000} />);

  expect(screen.getByText('Confirmed Deviation')).toHaveAttribute('data-route-tone', 'critical');
  expect(screen.getByText('10.46 km from assigned route')).toBeInTheDocument();
  expect(screen.getByText('Last GPS Update')).toBeInTheDocument();
  expect(screen.getByText('Bus Record Updated')).toBeInTheDocument();
  expect(screen.getByText('0.59 km/h')).toBeInTheDocument();
  expect(screen.getByText('14.095, 121.16')).toBeInTheDocument();

  rerender(<BusMarkerCallout bus={{ ...bus, updatedAt: null, gps: { online: true } }} nowMs={105000} />);
  expect(screen.getAllByText('Unavailable')).toHaveLength(2);
  expect(screen.getByText('Last known: Unavailable')).toHaveAttribute('data-route-tone', 'unavailable');
  expect(screen.getByText(/Capture time unavailable/)).toBeInTheDocument();
  expect(screen.getByText('Distance from assigned route unavailable')).toBeInTheDocument();
  expect(screen.getAllByText('Unknown')).toHaveLength(2);
  expect(screen.getByText('No update recorded')).toBeInTheDocument();
});

test('bus marker size scales linearly with zoom and remains clamped', () => {
  expect(getBusMarkerSize(0)).toBe(BUS_MARKER_MIN_SIZE);
  expect(getBusMarkerSize(10)).toBe(32);
  expect(getBusMarkerSize(12)).toBe(36);
  expect(getBusMarkerSize(12, true)).toBe(40);
  expect(getBusMarkerSize(16)).toBe(44);
  expect(getBusMarkerSize(30)).toBe(BUS_MARKER_MAX_SIZE);
});

test('expanded marker hit target stays centered while visible icon and popup anchors keep their geometry', () => {
  const icon = createBusMarkerIcon({ status: 'active' }, false, 16);
  expect(icon.options.markerVisibleSize).toBe(44);
  expect(icon.options.markerHitTargetSize).toBe(56);
  expect(icon.options.iconSize).toEqual([56, 62]);
  expect(icon.options.iconAnchor).toEqual([28, 58]);
  expect(icon.options.popupAnchor).toEqual([0, -60]);
  expect(icon.options.html).toContain('class="centrabus-marker__hit-area"');
  expect(icon.options.html).toContain('width:44px;height:44px');
  expect(getBusMarkerHitTargetSize(28)).toBe(44);
  expect(getBusMarkerHitTargetSize(36)).toBe(48);
  expect(getBusMarkerHitTargetSize(40)).toBe(52);
});

test('bus callout placement chooses the open side and clamps to map edges', () => {
  const map = {
    getSize: () => ({ x: 800, y: 400 }),
    latLngToContainerPoint: jest.fn(([lat, lng]) => ({ x: lng, y: lat })),
  };

  const rightEdge = getBusCalloutPlacement(map, [390, 760], { width: 284, height: 260, markerOffset: 22 });
  expect(rightEdge.direction).toBe('left');
  expect(rightEdge.offset[1]).toBeLessThan(0);

  const leftEdge = getBusCalloutPlacement(map, [10, 40], { width: 284, height: 260, markerOffset: 22 });
  expect(leftEdge.direction).toBe('right');
  expect(leftEdge.offset[1]).toBeGreaterThan(0);
});

test('bus markers receive deterministic identity colors and preserve them when selected', () => {
  expect(getBusMarkerIdentityColor({ id: 'bus-a' })).toBe(getBusMarkerIdentityColor({ id: 'bus-a' }));
  expect(getBusMarkerIdentityColor({ id: 'bus-a' })).not.toBe(getBusMarkerIdentityColor({ id: 'bus-b' }));
  const unselected = createBusMarkerIcon({ id: 'bus-a', status: 'active' }, false, 12);
  const selected = createBusMarkerIcon({ id: 'bus-a', status: 'active' }, true, 12);
  expect(unselected.options.html).toContain(`stroke="${getBusMarkerIdentityColor({ id: 'bus-a' })}"`);
  expect(selected.options.html).toContain(`--marker-selection-ring:${getBusMarkerIdentityColor({ id: 'bus-a' })}24`);
  expect(selected.options.html).toContain('is-selected');
  expect(selected.options.iconSize).toEqual(unselected.options.iconSize);
});

test.each([8, 12, 18])('grouped marker stays compact at zoom %s and selection does not shift its name pill or anchor', (zoom) => {
  const bus = { id: 'bus-a', gps: { updatedAt: 100000, online: true } };
  const normal = createBusMarkerIcon(bus, false, zoom, 105000, 'ABC 234');
  const selected = createBusMarkerIcon(bus, true, zoom, 105000, 'ABC 234');
  expect(normal.options.markerVisibleSize).toBeGreaterThanOrEqual(42);
  expect(normal.options.markerVisibleSize).toBeLessThanOrEqual(46);
  expect(selected.options.markerVisibleSize).toBe(normal.options.markerVisibleSize);
  expect(selected.options.iconAnchor).toEqual(normal.options.iconAnchor);
  expect(selected.options.iconSize).toEqual(normal.options.iconSize);
  expect(normal.options.html).toContain('centrabus-marker__label-text');
  expect(selected.options.html).toContain('centrabus-marker__hit-area is-selected');
  expect(selected.options.html).not.toMatch(/dashed|dotted/);
});

test('overlap candidates include screen-hit-area intersections while retaining the geographic overlap radius', () => {
  const origin = { id: 'origin', gps: { latitude: 0, longitude: 0 } };
  const closeOnScreen = { id: 'close-screen', gps: { latitude: 0, longitude: 0.001 } };
  const separate = { id: 'separate', gps: { latitude: 0.006, longitude: 0.006 } };
  const map = {
    getZoom: () => 12,
    latLngToContainerPoint: ([lat, lng]) => ({ x: lng * 10000, y: lat * 10000 }),
  };

  expect(getOverlappingBuses(origin, [origin, closeOnScreen, separate], BUS_OVERLAP_DISTANCE_M).map((bus) => bus.id)).toEqual(['origin']);
  expect(getOverlappingBuses(origin, [origin, closeOnScreen, separate], BUS_OVERLAP_DISTANCE_M, map).map((bus) => bus.id)).toEqual(['origin', 'close-screen']);
});

function createMarkerProjectionMap(scale) {
  return {
    latLngToContainerPoint: (position) => ({ x: Number(position[1]) * scale, y: Number(position[0]) * scale }),
    containerPointToLatLng: (point) => ({ lat: point.y / scale, lng: point.x / scale }),
  };
}

test.each([8, 12, 18])('integrated pin has one continuous body/tip outline anchored at its bottom at zoom %s', (zoom) => {
  const icon = createBusMarkerIcon({ id: 'bus-a' }, false, zoom, 105000, 'ABC 234');
  const element = document.createElement('div');
  element.innerHTML = icon.options.html;
  const size = icon.options.markerVisibleSize;
  const outline = element.querySelector('.centrabus-marker__pointer');
  expect(element.querySelectorAll('.centrabus-marker__shell path')).toHaveLength(1);
  expect(outline.getAttribute('d')).toContain(`L${size / 2} ${size + 9}`);
  expect(outline.getAttribute('d')).toMatch(/Z$/);
  expect(outline.getAttribute('stroke-width')).toBe('2');
  expect(icon.options.markerPointerLength).toBe(10);
  expect(icon.options.iconAnchor).toEqual([icon.options.iconSize[0] / 2, size + 14]);
  expect(element.querySelector('.centrabus-marker__body svg')).not.toBeNull();
  expect(element.querySelector('.centrabus-marker__label-text')).toHaveTextContent('ABC 234');
});

test('native Leaflet integrated tip click selects the same marker and cleans up without a separate line layer', () => {
  const container = document.createElement('div');
  Object.defineProperties(container, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  document.body.appendChild(container);
  const map = L.map(container, { zoomAnimation: false }).setView([0, 0], 12);
  const onClick = jest.fn();
  const marker = L.marker([0, 0], { icon: createBusMarkerIcon({ id: 'bus-a' }, false, 12, 105000, 'ABC 234') }).on('click', onClick).addTo(map);
  let removed = false;
  try {
    fireEvent.click(marker.getElement().querySelector('.centrabus-marker__pointer'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].target).toBe(marker);
    expect(container.querySelector('.leaflet-overlay-pane path')).toBeNull();
    expect(() => { map.remove(); removed = true; }).not.toThrow();
    expect(container.querySelector('.centrabus-marker')).toBeNull();
  } finally {
    if (!removed) map.remove();
    container.remove();
  }
});

test('pin body remains readable at low zoom and finite for invalid zoom input', () => {
  for (const zoom of [0, NaN, undefined, 30]) {
    const icon = createBusMarkerIcon({ id: 'bus-a' }, false, zoom);
    expect(icon.options.markerVisibleSize).toBeGreaterThanOrEqual(42);
    expect(icon.options.markerVisibleSize).toBeLessThanOrEqual(48);
    expect(icon.options.iconAnchor.every(Number.isFinite)).toBe(true);
    expect(icon.options.html).not.toContain('NaN');
  }
});

test('pin shell stays below the white bus glyph despite Leaflet SVG stacking and has restrained motion', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, 'index.css'), 'utf8');
  expect(css).toMatch(/\.centrabus-marker \.centrabus-marker__shell\s*\{[^}]*z-index:\s*0;/);
  expect(css).toMatch(/\.centrabus-marker__body\s*\{[^}]*z-index:\s*1;/);
  expect(css).toMatch(/\.centrabus-marker__pin\s*\{[^}]*transform-origin:\s*50% 100%;[^}]*transition:\s*transform 180ms/);
  expect(css).toMatch(/\.centrabus-marker__pin\.is-selected\s*\{[^}]*scale\(1\.05\)/);
  expect(css).toMatch(/\.centrabus-marker__hit-area:hover \.centrabus-marker__pin\s*\{[^}]*scale\(1\.03\)/);
});

test('single bus has an integrated tip but no separate line or GPS dot and remains individually selectable', () => {
  const projection = createMarkerProjectionMap(10000);
  mockLeafletMap.latLngToContainerPoint = projection.latLngToContainerPoint;
  mockLeafletMap.containerPointToLatLng = projection.containerPointToLatLng;
  const onSelect = jest.fn();
  const bus = { id: 'single', gps: { latitude: 0, longitude: 0, online: false } };
  const { unmount } = render(<ZoomAwareBusMarkers buses={[bus]} selectedBusId={null} onSelect={onSelect} nowMs={105000} />);
  try {
    expect(screen.queryByTestId('bus-marker-connector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bus-gps-anchor')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(bus, [bus]);
  } finally {
    unmount();
    delete mockLeafletMap.latLngToContainerPoint;
    delete mockLeafletMap.containerPointToLatLng;
  }
});

test('ungrouped location pin retains its compact plate/code label when fan-out is removed', () => {
  const element = document.createElement('div');
  element.innerHTML = createBusMarkerIcon({ id: 'bus-a', plateNumber: 'ABC 234' }, false, 18).options.html;
  expect(element.querySelector('.centrabus-marker__label-text')).toHaveTextContent('ABC 234');
  element.innerHTML = createBusMarkerIcon({ id: 'bus-b', busCode: 'Bus 2 <test>' }, false, 18).options.html;
  expect(element.querySelector('.centrabus-marker__label-text')).toHaveTextContent('Bus 2 <test>');
  expect(element.querySelector('test')).toBeNull();
});

test('coincident markers get stable separate pixel positions without changing true coordinates', () => {
  const buses = [
    { id: 'bus-b', gps: { latitude: 14, longitude: 121 } },
    { id: 'bus-a', gps: { latitude: 14, longitude: 121 } },
  ];
  const map = createMarkerProjectionMap(10000);
  const offsets = getNearbyBusMarkerOffsets(buses, map, 12);
  const positionA = getOffsetBusMarkerPosition(map, [14, 121], offsets.get('bus-a'));
  const positionB = getOffsetBusMarkerPosition(map, [14, 121], offsets.get('bus-b'));
  const screenA = map.latLngToContainerPoint(positionA);
  const screenB = map.latLngToContainerPoint(positionB);
  const reversedOffsets = getNearbyBusMarkerOffsets([...buses].reverse(), map, 12);

  expect(offsets.size).toBe(2);
  const actualPoint = map.latLngToContainerPoint([14, 121]);
  expect(screenA.x - actualPoint.x).toBeCloseTo(-26);
  expect(screenB.x - actualPoint.x).toBeCloseTo(26);
  expect(screenA.y - actualPoint.y).toBeCloseTo(0);
  expect(screenB.y - actualPoint.y).toBeCloseTo(0);
  expect(offsets.get('bus-a').sharedAnchorPosition).toEqual([14, 121]);
  expect(offsets.get('bus-b').sharedAnchorPosition).toEqual([14, 121]);
  expect([...offsets.values()].filter((offset) => offset.showAnchor)).toHaveLength(0);
  expect(offsets.get('bus-a').sharedGroupBusIds).toEqual(['bus-a', 'bus-b']);
  expect(reversedOffsets.get('bus-a')).toEqual(offsets.get('bus-a'));
  expect(buses.every((bus) => bus.gps.latitude === 14 && bus.gps.longitude === 121)).toBe(true);
});

test('nearby screen points fan out, while already-separated markers stay at their true positions', () => {
  const buses = [
    { id: 'a', gps: { latitude: 0, longitude: 0 } },
    { id: 'b', gps: { latitude: 0, longitude: 0.001 } },
  ];
  const map = createMarkerProjectionMap(10000);
  expect(Math.abs(map.latLngToContainerPoint([0, 0]).x - map.latLngToContainerPoint([0, 0.001]).x)).toBeLessThan(BUS_MARKER_NEARBY_DISTANCE_PX);
  expect(getNearbyBusMarkerOffsets(buses, map, 12).size).toBe(2);

  const separatedBuses = [buses[0], { ...buses[1], gps: { ...buses[1].gps, longitude: 0.008 } }];
  const separatedOffsets = getNearbyBusMarkerOffsets(separatedBuses, map, 12);
  expect(separatedOffsets.size).toBe(0);
  expect(getOffsetBusMarkerPosition(map, [0, 0.008], separatedOffsets.get('b'))).toEqual([0, 0.008]);
});

test('near-identical true positions share a real anchor only within both 3 metres and 10 pixels', () => {
  const map = createMarkerProjectionMap(10000);
  const busA = { id: 'a', gps: { latitude: 0, longitude: 0 } };
  const busB = { id: 'b', gps: { latitude: 0, longitude: 0.00001 } };
  expect(BUS_MARKER_SHARED_ANCHOR_DISTANCE_PX).toBe(10);
  expect(BUS_MARKER_SHARED_LOCATION_TOLERANCE_M).toBe(3);
  const shared = getNearbyBusMarkerOffsets([busA, busB], map);
  expect(shared.get('a').sharedAnchorPosition).toEqual([0, 0]);
  expect(shared.get('b').sharedAnchorPosition).toEqual([0, 0]);
  expect([...shared.values()].filter((offset) => offset.showAnchor)).toHaveLength(0);

  const separate = getNearbyBusMarkerOffsets([busA, { ...busB, gps: { latitude: 0, longitude: 0.003 } }], map);
  expect(separate.size).toBe(2);
  expect(separate.get('a').sharedAnchorPosition).toBeNull();
  expect(separate.get('b').sharedAnchorPosition).toBeNull();
  expect([...separate.values()].filter((offset) => offset.showAnchor)).toHaveLength(2);
});

test('a chain of close anchors does not merge different true positions into a shared dot', () => {
  const buses = ['a', 'b', 'c'].map((id, index) => ({ id, gps: { latitude: 0, longitude: index * 0.0008 } }));
  const offsets = getNearbyBusMarkerOffsets(buses, createMarkerProjectionMap(10000));
  expect([...offsets.values()].every((offset) => offset.sharedAnchorPosition === null && offset.showAnchor)).toBe(true);
});

test('screen-coincident but geographically distinct buses never claim a shared tail at low zoom', () => {
  const buses = ['a', 'b'].map((id, index) => ({ id, gps: { latitude: 0, longitude: index * 0.001 } }));
  const offsets = getNearbyBusMarkerOffsets(buses, createMarkerProjectionMap(1000), 8);
  expect(offsets.size).toBe(2);
  expect([...offsets.values()].every((offset) => !offset.sharedGroupKey && offset.showAnchor)).toBe(true);
});

test('275 m low-zoom collision fans marker bodies apart but keeps two true GPS anchors', () => {
  const scale = 1000;
  const map = createMarkerProjectionMap(scale);
  const secondLatitude = 275 / 111195;
  const buses = [
    { id: 'bus-a', gps: { latitude: 14, longitude: 121 } },
    { id: 'bus-b', gps: { latitude: 14 + secondLatitude, longitude: 121 } },
  ];
  const offsets = getNearbyBusMarkerOffsets(buses, map, 8);
  const truePointDistancePx = Math.hypot(
    map.latLngToContainerPoint([14, 121]).x - map.latLngToContainerPoint([14 + secondLatitude, 121]).x,
    map.latLngToContainerPoint([14, 121]).y - map.latLngToContainerPoint([14 + secondLatitude, 121]).y,
  );
  const bodyPositions = buses.map((bus) => getOffsetBusMarkerPosition(
    map,
    [bus.gps.latitude, bus.gps.longitude],
    offsets.get(bus.id),
  ));
  const bodyPoints = bodyPositions.map((position) => map.latLngToContainerPoint(position));

  expect(truePointDistancePx).toBeLessThan(BUS_MARKER_NEARBY_DISTANCE_PX);
  expect(offsets.size).toBe(2);
  expect([...offsets.values()].every((offset) => offset.sharedGroupKey === null
    && offset.sharedAnchorPosition === null && offset.showAnchor)).toBe(true);
  expect(Math.hypot(bodyPoints[0].x - bodyPoints[1].x, bodyPoints[0].y - bodyPoints[1].y)).toBeGreaterThan(40);
  expect(buses.map((bus) => [bus.gps.latitude, bus.gps.longitude])).toEqual([
    [14, 121],
    [14 + secondLatitude, 121],
  ]);

  const previousProjection = mockLeafletMap.latLngToContainerPoint;
  const previousInverseProjection = mockLeafletMap.containerPointToLatLng;
  mockLeafletMap.latLngToContainerPoint = map.latLngToContainerPoint;
  mockLeafletMap.containerPointToLatLng = map.containerPointToLatLng;
  const { unmount } = render(<ZoomAwareBusMarkers buses={buses} selectedBusId="bus-a" onSelect={jest.fn()} nowMs={105000} />);
  try {
    const markerHtml = screen.getAllByRole('button').map((marker) => marker.getAttribute('data-icon-html'));
    expect(screen.queryByTestId('shared-bus-marker')).not.toBeInTheDocument();
    expect(markerHtml).toHaveLength(2);
    expect(markerHtml.every((html) => html.includes('centrabus-marker__pointer')
      && !html.includes('centrabus-marker-group__shell'))).toBe(true);
    const anchors = screen.getAllByTestId('bus-gps-anchor');
    expect(anchors).toHaveLength(2);
    expect(anchors.map((anchor) => anchor.getAttribute('data-position'))).toEqual([
      '14,121',
      `${14 + secondLatitude},121`,
    ]);
    expect(screen.queryByTestId('bus-marker-connector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bus-marker-connector-halo')).not.toBeInTheDocument();
  } finally {
    unmount();
    mockLeafletMap.latLngToContainerPoint = previousProjection;
    mockLeafletMap.containerPointToLatLng = previousInverseProjection;
  }
});

test('complete-link sharing recognizes a close subset without collapsing a geographic chain', () => {
  const buses = ['a', 'b', 'c'].map((id, index) => ({ id, gps: { latitude: 0, longitude: index * 0.000016 } }));
  const offsets = getNearbyBusMarkerOffsets(buses, createMarkerProjectionMap(10000));
  expect(offsets.get('a').sharedGroupBusIds).toEqual(['a', 'b']);
  expect(offsets.get('b').sharedGroupBusIds).toEqual(['a', 'b']);
  expect(offsets.get('c').sharedGroupKey).toBeNull();
});

test('composite marker has one shared tail, independent escaped labels and selected accent chips', () => {
  const buses = [
    { id: 'b', busCode: 'Bus 2', gps: { online: false } },
    { id: 'a', plateNumber: 'ABC <234>', gps: { latitude: 0, longitude: 0, updatedAt: 1000, online: true } },
  ];
  const icon = createSharedBusMarkerIcon(buses, 'b', 12, 105000);
  const element = document.createElement('div');
  element.innerHTML = icon.options.html;
  expect(icon.options.sharedGroupBusIds).toEqual(['a', 'b']);
  expect(icon.options.iconAnchor).toEqual([52, 60]);
  expect(element.querySelectorAll('.centrabus-marker-group__tail')).toHaveLength(1);
  expect(element.querySelector('.centrabus-marker__pointer')).toBeNull();
  expect([...element.querySelectorAll('button')].map((chip) => chip.dataset.busId)).toEqual(['a', 'b']);
  expect(element.querySelector('[data-bus-id="b"]')).toHaveAttribute('aria-pressed', 'true');
  expect(element.querySelector('[data-bus-id="a"] .centrabus-marker__label-text')).toHaveTextContent('ABC <234>');
  expect(icon.options.html).toContain('ABC &lt;234&gt;');
  expect(element.querySelector('[data-bus-id="a"] .centrabus-marker__label-text').children).toHaveLength(0);
  expect(element.querySelector('[data-bus-id="a"] .centrabus-marker__body').dataset.gpsStatus).toBe('Stale');
  expect(element.querySelector('[data-bus-id="b"] .centrabus-marker__body').dataset.gpsStatus).toBe('Offline');
  buses.forEach((bus) => expect(element.querySelector(`[data-bus-id="${bus.id}"] .centrabus-marker__outline`).getAttribute('stroke')).toBe(getBusMarkerIdentityColor(bus)));
});

const sharedLocationBuses = [
  { id: 'a', plateNumber: 'ABC 234', gps: { latitude: 0, longitude: 0, online: false, updatedAt: 1000 } },
  { id: 'b', plateNumber: 'XYZ 567', gps: { latitude: 0, longitude: 0, online: false, updatedAt: 1000 } },
];

test('shared chips preview individually, pin the exact clicked bus and close without deselecting', () => {
  Object.assign(mockLeafletMap, createMarkerProjectionMap(10000));
  const { unmount } = render(<PopupSelectionHarness buses={sharedLocationBuses} />);
  try {
    const chipA = screen.getByRole('button', { name: 'Select bus ABC 234' });
    const chipB = screen.getByRole('button', { name: 'Select bus XYZ 567' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.pointerOver(chipA);
    expect(screen.getByRole('tooltip')).toHaveAttribute('data-pinned', 'false');
    expect(within(screen.getByRole('tooltip')).getByText('ABC 234')).toBeInTheDocument();
    fireEvent(chipA, new MouseEvent('pointerout', { bubbles: true, relatedTarget: chipB }));
    expect(within(screen.getByRole('tooltip')).getByText('XYZ 567')).toBeInTheDocument();
    fireEvent.pointerOut(chipB);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(chipB);
    expect(screen.getByLabelText('Selected popup bus')).toHaveTextContent('b');
    expect(screen.getByRole('tooltip')).toHaveAttribute('data-pinned', 'true');
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Select bus ABC 234' }));
    expect(within(screen.getByRole('tooltip')).getByText('XYZ 567')).toBeInTheDocument();
    fireEvent.pointerOut(screen.getByRole('button', { name: 'Select bus ABC 234' }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close bus popup' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Selected popup bus')).toHaveTextContent('b');
  } finally {
    unmount();
    delete mockLeafletMap.latLngToContainerPoint;
    delete mockLeafletMap.containerPointToLatLng;
  }
});

test('shared group keeps its keyed marker and bus ordering through GPS updates and removes delegated listeners', () => {
  Object.assign(mockLeafletMap, createMarkerProjectionMap(10000));
  const onSelect = jest.fn();
  const { rerender, unmount } = render(<ZoomAwareBusMarkers buses={sharedLocationBuses} selectedBusId="b" onSelect={onSelect} nowMs={105000} />);
  const group = screen.getByTestId('shared-bus-marker');
  const removeListener = jest.spyOn(group, 'removeEventListener');
  try {
    const updated = [...sharedLocationBuses].reverse().map((bus) => ({ ...bus, gps: { ...bus.gps, latitude: 0.00001 } }));
    rerender(<ZoomAwareBusMarkers buses={updated} selectedBusId="b" onSelect={onSelect} nowMs={105000} />);
    expect(screen.getByTestId('shared-bus-marker')).toBe(group);
    expect([...group.querySelectorAll('[data-bus-id]')].map((chip) => chip.dataset.busId)).toEqual(['a', 'b']);
    expect(group).toHaveAttribute('data-position', '0.00001,0');
    expect(group.querySelectorAll('.centrabus-marker-group__tail')).toHaveLength(1);
    fireEvent.click(group.querySelector('.centrabus-marker-group__tail'));
    expect(onSelect).not.toHaveBeenCalled();
  } finally {
    unmount();
    for (const event of ['pointerover', 'pointerout', 'focusin', 'focusout']) expect(removeListener).toHaveBeenCalledWith(event, expect.any(Function));
    delete mockLeafletMap.latLngToContainerPoint;
    delete mockLeafletMap.containerPointToLatLng;
  }
});

test('zoom separates nearly identical buses into individual pins and regrouping preserves selection/pinned popup', () => {
  let scale = 10000;
  mockLeafletMap.latLngToContainerPoint = ([lat, lng]) => ({ x: lng * scale, y: lat * scale });
  mockLeafletMap.containerPointToLatLng = ({ x, y }) => ({ lat: y / scale, lng: x / scale });
  const buses = sharedLocationBuses.map((bus, index) => ({ ...bus, gps: { ...bus.gps, longitude: index * 0.00001 } }));
  const { unmount } = render(<PopupSelectionHarness buses={buses} />);
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Select bus XYZ 567' }));
    const zoomHandler = mockLeafletMap.on.mock.calls.find(([name]) => name === 'zoomend')[1];
    scale = 6000000;
    act(() => zoomHandler());
    expect(screen.queryByTestId('shared-bus-marker')).not.toBeInTheDocument();
    const pins = screen.getAllByRole('button', { name: /Marker / });
    expect(pins).toHaveLength(2);
    expect(pins.every((pin) => pin.getAttribute('data-icon-html').includes('centrabus-marker__pointer'))).toBe(true);
    expect(screen.getByLabelText('Selected popup bus')).toHaveTextContent('b');
    expect(within(screen.getByRole('tooltip')).getByText('XYZ 567')).toBeInTheDocument();
    scale = 10000;
    act(() => zoomHandler());
    expect(screen.getAllByTestId('shared-bus-marker')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Select bus XYZ 567' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tooltip')).toHaveAttribute('data-pinned', 'true');
  } finally {
    unmount();
    delete mockLeafletMap.latLngToContainerPoint;
    delete mockLeafletMap.containerPointToLatLng;
  }
});

test('fan labels use plate numbers or stable bus fallback labels and escape HTML', () => {
  const buses = [
    { id: 'a', plateNumber: 'ABC 234', gps: { latitude: 0, longitude: 0 } },
    { id: 'b', gps: { latitude: 0, longitude: 0 } },
  ];
  const offsets = getNearbyBusMarkerOffsets(buses, createMarkerProjectionMap(10000));
  expect(offsets.get('a').label).toBe('ABC 234');
  expect(offsets.get('b').label).toBe('Bus 2');
  const groupedIcon = createBusMarkerIcon(buses[0], false, 12, 105000, 'ABC <234> & "bus"');
  expect(groupedIcon.options.html).toContain('ABC &lt;234&gt; &amp; &quot;bus&quot;');
  expect(createBusMarkerIcon(buses[0]).options.html).toContain('ABC 234');
  expect(createBusMarkerIcon({ id: 'unnamed' }).options.html).not.toContain('centrabus-marker__fan-label');
});

test('three nearby buses spread radially and keep each bus on its stable side during small GPS updates', () => {
  const buses = ['a', 'b', 'c'].map((id) => ({ id, gps: { latitude: 10, longitude: 20 } }));
  const map = createMarkerProjectionMap(10000);
  const firstOffsets = getNearbyBusMarkerOffsets(buses, map, 12);
  const firstTargets = buses.map((bus) => getOffsetBusMarkerPosition(map, [10, 20], firstOffsets.get(bus.id)));
  const movedBuses = buses.map((bus, index) => ({ ...bus, gps: { ...bus.gps, longitude: 20 + ((index + 1) * 0.00002) } }));
  const movedOffsets = getNearbyBusMarkerOffsets(movedBuses, map, 12);
  const movedTargets = movedBuses.map((bus) => getOffsetBusMarkerPosition(map, [10, bus.gps.longitude], movedOffsets.get(bus.id)));

  expect(firstOffsets.size).toBe(3);
  expect(new Set(firstTargets.map((position) => `${position[0].toFixed(5)},${position[1].toFixed(5)}`)).size).toBe(3);
  expect(new Set(movedTargets.map((position) => `${position[0].toFixed(5)},${position[1].toFixed(5)}`)).size).toBe(3);
  expect(Math.sign(movedOffsets.get('a').y)).toBe(Math.sign(firstOffsets.get('a').y));
  ['b', 'c'].forEach((busId) => {
    expect(Math.sign(movedOffsets.get(busId).x)).toBe(Math.sign(firstOffsets.get(busId).x));
  });
});

test('zooming changes pixel proximity so separated buses return to true coordinates', () => {
  const buses = [
    { id: 'a', gps: { latitude: 0, longitude: 0 } },
    { id: 'b', gps: { latitude: 0, longitude: 0.01 } },
  ];
  expect(getNearbyBusMarkerOffsets(buses, createMarkerProjectionMap(1000), 8).size).toBe(2);
  expect(getNearbyBusMarkerOffsets(buses, createMarkerProjectionMap(10000), 16).size).toBe(0);
});

test('map zoom, pan and resize listeners recalculate marker offsets and are cleaned up', () => {
  let scale = 10000;
  mockLeafletMap.latLngToContainerPoint = ([lat, lng]) => ({ x: lng * scale, y: lat * scale });
  mockLeafletMap.containerPointToLatLng = ({ x, y }) => ({ lat: y / scale, lng: x / scale });
  const buses = [
    { id: 'a', gps: { latitude: 0, longitude: 0 } },
    { id: 'b', gps: { latitude: 0, longitude: 0.001 } },
  ];
  const { unmount } = render(<ZoomAwareBusMarkers buses={buses} selectedBusId={null} onSelect={jest.fn()} nowMs={105000} />);
  try {
    let markers = screen.getAllByRole('button');
    expect(screen.queryByTestId('bus-marker-connector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bus-marker-connector-halo')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('bus-gps-anchor')).toHaveLength(2);
    expect(markers[0].getAttribute('aria-label')).not.toBe(markers[1].getAttribute('aria-label'));
    for (const eventName of ['zoomend', 'moveend', 'resize']) {
      expect(mockLeafletMap.on).toHaveBeenCalledWith(eventName, expect.any(Function));
    }

    scale = 100000;
    mockLeafletMap.getZoom.mockReturnValue(16);
    const zoomHandler = mockLeafletMap.on.mock.calls.find(([eventName]) => eventName === 'zoomend')[1];
    act(() => zoomHandler());
    markers = screen.getAllByRole('button');
    expect(markers[0]).toHaveAccessibleName('Marker 0,0');
    expect(markers[1]).toHaveAccessibleName('Marker 0,0.001');
    expect(screen.queryByTestId('bus-marker-connector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bus-gps-anchor')).not.toBeInTheDocument();
  } finally {
    unmount();
    delete mockLeafletMap.latLngToContainerPoint;
    delete mockLeafletMap.containerPointToLatLng;
  }
  for (const eventName of ['zoomend', 'moveend', 'resize']) {
    expect(mockLeafletMap.off).toHaveBeenCalledWith(eventName, expect.any(Function));
  }
});

test.each(['Online', 'Delayed', 'Stale', 'Offline', 'Unknown'])('GPS %s keeps the accepted dark body and solid identity ring', (status) => {
  const gps = { latitude: 14.095, longitude: 121.16, online: status !== 'Offline', updatedAt: status === 'Unknown' ? null : status === 'Stale' ? 1000 : status === 'Delayed' ? 65000 : 100000 };
  const bus = { id: 'bus-a', status: 'active', gps };
  const element = document.createElement('div');
  element.innerHTML = createBusMarkerIcon(bus, false, 12, 105000).options.html;
  const body = element.querySelector('.centrabus-marker__body');
  const outline = element.querySelector('.centrabus-marker__pointer');
  expect(outline.getAttribute('fill')).toBe('#0f172a');
  expect(body.style.borderStyle).not.toBe('dashed');
  expect(body.dataset.gpsStatus).toBe(status);
  expect(outline.getAttribute('stroke')).toBe(getBusMarkerIdentityColor(bus));
  const cue = body.querySelector('.centrabus-marker__status-cue');
  if (status === 'Online') expect(cue).toBeNull();
  else {
    expect(cue.dataset.status).toBe(status);
    expect(cue.title).toBe(`GPS ${status}`);
  }
  expect(element.innerHTML).not.toMatch(/dashed|dotted|gps-halo/);
});

test.each(['Stale', 'Offline'])('selected %s marker retains body/accent identity with a stronger outer selection highlight', (status) => {
  const bus = { id: 'bus-a', status: 'active', gps: { online: status !== 'Offline', updatedAt: 1000 } };
  const html = createBusMarkerIcon(bus, true, 12, 105000).options.html;
  expect(html).toContain('fill="#0f172a"');
  expect(html).toContain(`stroke="${getBusMarkerIdentityColor(bus)}"`);
  expect(html).toContain('is-selected');
  expect(html).toContain(`--marker-selection-ring:${getBusMarkerIdentityColor(bus)}24`);
  expect(html).toContain('centrabus-marker__status-cue');
});

function PopupSelectionHarness({ buses = overviewBuses }) {
  const [selected, setSelected] = useState(null);
  return <><output aria-label="Selected popup bus">{selected || 'none'}</output><ZoomAwareBusMarkers buses={buses} selectedBusId={selected} onSelect={(bus) => setSelected(bus.id)} nowMs={105000} /></>;
}

test('hover is a temporary preview; click pins it after mouse leave without losing selection', () => {
  render(<PopupSelectionHarness />);
  const marker = screen.getByRole('button', { name: 'Marker 14.095,121.16' });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.mouseEnter(marker);
  expect(screen.getByRole('tooltip')).toHaveAttribute('data-pinned', 'false');
  fireEvent.mouseLeave(marker);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.mouseEnter(marker);
  fireEvent.click(marker);
  fireEvent.mouseLeave(marker);
  expect(screen.getByRole('tooltip')).toHaveAttribute('data-pinned', 'true');
  expect(screen.getByLabelText('Selected popup bus')).toHaveTextContent('bus-a');
  expect(within(screen.getByRole('tooltip')).getByText('ABC 234')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marker 14.095,121.16' })).toBe(marker);
});

test('another marker transfers the single pinned card; close does not deselect and hover still works', () => {
  render(<PopupSelectionHarness />);
  const a = screen.getByRole('button', { name: 'Marker 14.095,121.16' });
  const b = screen.getByRole('button', { name: 'Marker 14.1,121.17' });
  fireEvent.click(a);
  fireEvent.click(b);
  expect(screen.getAllByRole('tooltip')).toHaveLength(1);
  expect(within(screen.getByRole('tooltip')).getByText('CRK 160')).toBeInTheDocument();
  expect(screen.getByLabelText('Selected popup bus')).toHaveTextContent('bus-b');
  fireEvent.click(screen.getByRole('button', { name: 'Close bus popup' }));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Selected popup bus')).toHaveTextContent('bus-b');
  expect(screen.getByRole('button', { name: 'Marker 14.095,121.16' })).toBe(a);
  expect(screen.getByRole('button', { name: 'Marker 14.1,121.17' })).toBe(b);
  fireEvent.mouseEnter(b);
  expect(screen.getByRole('tooltip')).toHaveAttribute('data-pinned', 'false');
  fireEvent.mouseLeave(b);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

test('Realtime coordinate updates and bus reordering do not steal the selected bus', () => {
  const { rerender } = render(<PopupSelectionHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Marker 14.1,121.17' }));
  expect(screen.getByLabelText('Selected popup bus')).toHaveTextContent('bus-b');

  const updatedBuses = [
    { ...overviewBuses[1], gps: { ...overviewBuses[1].gps, latitude: 14.101, updatedAt: 101000 } },
    { ...overviewBuses[0], gps: { ...overviewBuses[0].gps, latitude: 14.096, updatedAt: 101000 } },
  ];
  rerender(<PopupSelectionHarness buses={updatedBuses} />);

  expect(screen.getByLabelText('Selected popup bus')).toHaveTextContent('bus-b');
  expect(within(screen.getByRole('tooltip')).getByText('CRK 160')).toBeInTheDocument();
});

test.each(['Stale', 'Offline'])('%s card pins with original GPS age and status', (status) => {
  const bus = { ...overviewBuses[0], gps: { ...overviewBuses[0].gps, updatedAt: 1000, online: status !== 'Offline' } };
  render(<PopupSelectionHarness buses={[bus]} />);
  const marker = screen.getByRole('button', { name: 'Marker 14.095,121.16' });
  fireEvent.click(marker);
  fireEvent.mouseLeave(marker);
  const card = screen.getByRole('tooltip');
  expect(card).toHaveAttribute('data-pinned', 'true');
  expect(within(card).getByText(status)).toBeInTheDocument();
  expect(within(card).getByText(/1 minute ago/)).toBeInTheDocument();
  expect(within(card).getByText('Last-known GPS position')).toBeInTheDocument();
});

test('status/icon updates do not remount either bus or close the pinned card', () => {
  const { rerender } = render(<PopupSelectionHarness />);
  const a = screen.getByRole('button', { name: 'Marker 14.095,121.16' });
  const b = screen.getByRole('button', { name: 'Marker 14.1,121.17' });
  fireEvent.click(a);
  const staleBuses = overviewBuses.map((bus) => ({ ...bus, gps: { ...bus.gps, updatedAt: 1000, online: bus.id !== 'bus-b' } }));
  rerender(<PopupSelectionHarness buses={staleBuses} />);
  expect(screen.getByRole('button', { name: 'Marker 14.095,121.16' })).toBe(a);
  expect(screen.getByRole('button', { name: 'Marker 14.1,121.17' })).toBe(b);
  expect(a).toHaveAttribute('data-icon-html', expect.stringContaining('data-gps-status="Stale"'));
  expect(b).toHaveAttribute('data-icon-html', expect.stringContaining('data-gps-status="Offline"'));
  expect(screen.getByRole('tooltip')).toHaveAttribute('data-pinned', 'true');
  expect(within(screen.getByRole('tooltip')).getByText('Stale')).toBeInTheDocument();
});

test('removing the pinned bus closes its overlay without losing the remaining marker', () => {
  const { rerender } = render(<PopupSelectionHarness />);
  const b = screen.getByRole('button', { name: 'Marker 14.1,121.17' });
  fireEvent.click(screen.getByRole('button', { name: 'Marker 14.095,121.16' }));
  rerender(<PopupSelectionHarness buses={[overviewBuses[1]]} />);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marker 14.1,121.17' })).toBe(b);
});

test.each(['unmount', 'unload'])('pinned overlay cleanup ignores late placement callbacks on %s', (mode) => {
  const frames = markerAnimationHarness();
  const { unmount } = render(<PopupSelectionHarness />);
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Marker 14.095,121.16' }));
    const late = Array.from(frames.pending.values());
    expect(late.length).toBeGreaterThan(0);
    if (mode === 'unmount') unmount();
    else act(() => {
      mockLeafletMap._loaded = false;
      mockLeafletMap.on.mock.calls.filter(([event]) => event === 'unload').forEach(([, callback]) => callback());
    });
    const requested = frames.request.mock.calls.length;
    act(() => late.forEach((callback) => callback(2000)));
    expect(frames.pending.size).toBe(0);
    expect(frames.request).toHaveBeenCalledTimes(requested);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(mockLeafletMap.off).toHaveBeenCalledWith('tooltipopen', expect.any(Function));
  } finally { delete mockLeafletMap._loaded; unmount(); frames.restore(); }
});

test('native Leaflet tooltip modes survive mouse leave/pan and clean up without removed-pane errors', () => {
  const L = require('leaflet');
  const container = document.createElement('div');
  Object.defineProperties(container, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  document.body.appendChild(container);
  const map = L.map(container, { zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([14.095, 121.16], 13);
  const marker = L.marker([14.095, 121.16], { icon: createBusMarkerIcon(overviewBuses[0]) }).addTo(map);
  let removed = false;
  try {
    marker.bindTooltip('preview');
    marker.fire('mouseover');
    expect(marker.isTooltipOpen()).toBe(true);
    marker.fire('mouseout');
    expect(marker.isTooltipOpen()).toBe(false);
    marker.unbindTooltip();
    marker.bindTooltip('pinned', { permanent: true, interactive: true });
    marker.fire('mouseout');
    expect(marker.isTooltipOpen()).toBe(true);
    map.panBy([20, 20], { animate: false });
    map.setZoom(14, { animate: false });
    expect(marker.isTooltipOpen()).toBe(true);
    marker.setIcon(createBusMarkerIcon({ ...overviewBuses[0], gps: { ...overviewBuses[0].gps, updatedAt: 1000 } }, true, 14, 105000));
    expect(marker.isTooltipOpen()).toBe(true);
    marker.setLatLng([14.096, 121.16]);
    expect(marker.getTooltip().getLatLng().lat).toBe(14.096);
    expect(() => { map.remove(); removed = true; }).not.toThrow();
    expect(() => marker.unbindTooltip()).not.toThrow();
  } finally { if (!removed) map.remove(); container.remove(); }
});

test('Leaflet zoom events resize the marker without moving it or resetting the viewport', () => {
  mockLeafletMap.getZoom.mockReturnValue(10);
  const bus = { id: 'zoom-bus', status: 'active', gps: { latitude: 14.095, longitude: 121.16, online: true, updatedAt: 100000 } };
  render(<ZoomAwareBusMarkers buses={[bus]} selectedBusId={null} onSelect={jest.fn()} nowMs={105000} />);
  const marker = screen.getByRole('button', { name: 'Marker 14.095,121.16' });
  expect(marker).toHaveAttribute('data-icon-size', '42');

  const zoomHandler = mockLeafletMap.on.mock.calls.find(([eventName]) => eventName === 'zoomend')[1];
  mockLeafletMap.getZoom.mockReturnValue(16);
  act(() => zoomHandler());
  expect(marker).toHaveAttribute('data-icon-size', '44');
  expect(marker).toHaveAccessibleName('Marker 14.095,121.16');
  expect(mockLeafletMap.setView).not.toHaveBeenCalled();
  expect(mockLeafletMap.fitBounds).not.toHaveBeenCalled();
  expect(mockLeafletMap.flyTo).not.toHaveBeenCalled();
  expect(mockLeafletMap.flyToBounds).not.toHaveBeenCalled();
});

test('live marker coordinates update without invoking viewport controls', () => {
  const animationCallbacks = [];
  const requestFrame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    animationCallbacks.push(callback);
    return animationCallbacks.length;
  });
  const cancelFrame = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const bus = { id: 'moving-bus', status: 'active', gps: { latitude: 14.095, longitude: 121.16, online: true, updatedAt: 100000 } };
  const { rerender } = render(<AnimatedBusMarker bus={bus} icon={{}} isSelected={false} onSelect={jest.fn()} nowMs={105000} />);
  expect(screen.getByRole('button', { name: 'Marker 14.095,121.16' })).toBeInTheDocument();

  rerender(<AnimatedBusMarker bus={{ ...bus, gps: { ...bus.gps, latitude: 14.0951, longitude: 121.1601 } }} icon={{}} isSelected={false} onSelect={jest.fn()} nowMs={105000} />);
  const animationStart = performance.now();
  act(() => animationCallbacks.shift()(animationStart + 1000));
  expect(screen.getByRole('button', { name: 'Marker 14.0951,121.1601' })).toBeInTheDocument();
  expect(mockLeafletMap.setView).not.toHaveBeenCalled();
  expect(mockLeafletMap.fitBounds).not.toHaveBeenCalled();
  expect(mockLeafletMap.flyTo).not.toHaveBeenCalled();
  requestFrame.mockRestore();
  cancelFrame.mockRestore();
});

function markerAnimationHarness() {
  let clock = 0;
  let nextId = 0;
  const pending = new Map();
  const request = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  });
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => pending.delete(id));
  const now = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  return {
    pending, request, cancel,
    setClock: (value) => { clock = value; },
    frame: (value) => {
      clock = value;
      const [id, callback] = pending.entries().next().value;
      pending.delete(id);
      act(() => callback(value));
    },
    restore: () => { request.mockRestore(); cancel.mockRestore(); now.mockRestore(); },
  };
}

const animationBus = (latitude = 14.095, extra = {}) => ({
  id: 'animation-bus', status: 'active', plateNumber: 'TEST',
  gps: { latitude, longitude: 121.16, online: true, updatedAt: 100000, ...extra },
});

test('marker snaps to a fresh fix after a long capture-time gap without queuing animation', () => {
  const frames = markerAnimationHarness();
  const props = { icon: {}, onSelect: jest.fn(), nowMs: 205000 };
  const { rerender, unmount } = render(<AnimatedBusMarker {...props} bus={animationBus(14.095, { gpsUpdatedAt: 100000 })} />);
  try {
    rerender(<AnimatedBusMarker {...props} bus={animationBus(14.096, { gpsUpdatedAt: 200000 })} />);
    expect(screen.getByRole('button', { name: 'Marker 14.096,121.16' })).toBeInTheDocument();
    expect(frames.pending.size).toBe(0);
  } finally { unmount(); frames.restore(); }
});

test('marker interpolates and retargets from rendered position while actual GPS/callout stays current', () => {
  const frames = markerAnimationHarness();
  const props = { icon: {}, onSelect: jest.fn(), nowMs: 105000 };
  const { rerender, unmount } = render(<AnimatedBusMarker {...props} bus={animationBus()} />);
  try {
    expect(frames.pending.size).toBe(0); // first fix is direct
    const actual = animationBus(14.096);
    Object.freeze(actual.gps);
    rerender(<AnimatedBusMarker {...props} bus={actual} />);
    frames.frame(200);
    const halfwayLabel = screen.getByRole('button').getAttribute('aria-label');
    expect(Number(halfwayLabel.split(' ')[1].split(',')[0])).toBeCloseTo(14.0955, 8);
    const latest = animationBus(14.097);
    rerender(<AnimatedBusMarker {...props} bus={latest} />);
    expect(frames.cancel).toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', halfwayLabel);
    expect(frames.pending.size).toBe(1);
    frames.frame(275);
    const latitude = Number(screen.getByRole('button').getAttribute('aria-label').split(' ')[1].split(',')[0]);
    expect(latitude).toBeGreaterThan(14.0955);
    expect(latitude).toBeLessThan(14.097);
    expect(latest.gps.latitude).toBe(14.097);
    const callout = render(<BusMarkerCallout bus={latest} nowMs={105000} />);
    expect(callout.getByText('14.097, 121.16')).toBeInTheDocument();
    callout.unmount();
    frames.frame(350);
    expect(screen.getByRole('button', { name: 'Marker 14.097,121.16' })).toBeInTheDocument();
    expect(frames.pending.size).toBe(0);
  } finally { unmount(); frames.restore(); }
});

test.each(['invalid', 'null-coordinate', 'stale', 'offline', 'no-data', 'bus-change', 'jump'])('marker cancels display animation on %s', (mode) => {
  const frames = markerAnimationHarness();
  const props = { icon: {}, onSelect: jest.fn(), nowMs: 105000 };
  const { rerender, unmount } = render(<AnimatedBusMarker {...props} bus={animationBus()} />);
  try {
    rerender(<AnimatedBusMarker {...props} bus={animationBus(14.096)} />);
    const lateFrame = frames.pending.get(0);
    const bus = mode === 'invalid' ? animationBus(91)
      : mode === 'null-coordinate' ? animationBus(null)
      : mode === 'offline' ? animationBus(14.096, { online: false })
      : mode === 'no-data' ? { ...animationBus(), gps: undefined }
      : mode === 'bus-change' ? { ...animationBus(14.098), id: 'another-bus' }
      : mode === 'jump' ? animationBus(15.1) : animationBus(14.096);
    rerender(<AnimatedBusMarker {...props} bus={bus} nowMs={mode === 'stale' ? 200000 : 105000} />);
    expect(frames.cancel).toHaveBeenCalledWith(0);
    expect(frames.pending.size).toBe(0);
    const before = screen.getByRole('button').getAttribute('aria-label');
    act(() => lateFrame(2000)); // even a cancelled callback delivered late is inert
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', before);
    expect(frames.pending.size).toBe(0);
  } finally { unmount(); frames.restore(); }
});

test.each(['unmount', 'unload'])('marker animation cannot touch a destroyed map after %s', (mode) => {
  const frames = markerAnimationHarness();
  const props = { icon: {}, onSelect: jest.fn(), nowMs: 105000 };
  const { rerender, unmount } = render(<AnimatedBusMarker {...props} bus={animationBus()} />);
  try {
    rerender(<AnimatedBusMarker {...props} bus={animationBus(14.096)} />);
    const lateFrame = frames.pending.get(0);
    if (mode === 'unmount') unmount();
    else act(() => mockLeafletMap.on.mock.calls.find(([name]) => name === 'unload')[1]());
    expect(frames.pending.size).toBe(0);
    const requestCount = frames.request.mock.calls.length;
    act(() => lateFrame(2000));
    expect(frames.request).toHaveBeenCalledTimes(requestCount);
    if (mode === 'unload') {
      rerender(<AnimatedBusMarker {...props} bus={animationBus(14.097)} />);
      expect(frames.pending.size).toBe(0);
    }
  } finally { unmount(); frames.restore(); }
});

test('marker duration adapts to 3-second arrivals but stays bounded without extrapolation', () => {
  const frames = markerAnimationHarness();
  const props = { icon: {}, onSelect: jest.fn(), nowMs: 105000 };
  const { rerender, unmount } = render(<AnimatedBusMarker {...props} bus={animationBus()} />);
  try {
    rerender(<AnimatedBusMarker {...props} bus={animationBus(14.096)} />);
    frames.frame(900);
    frames.setClock(3000);
    rerender(<AnimatedBusMarker {...props} bus={animationBus(14.097)} />);
    frames.frame(3450);
    expect(screen.queryByRole('button', { name: 'Marker 14.097,121.16' })).not.toBeInTheDocument();
    frames.frame(3900);
    expect(screen.getByRole('button', { name: 'Marker 14.097,121.16' })).toBeInTheDocument();
    expect(frames.pending.size).toBe(0);
  } finally { unmount(); frames.restore(); }
});

test.each([[null, 400], [500, 150], [1000, 300], [2000, 600], [3000, 900], [12000, 1000]])(
  'marker spacing %s uses %sms presentation duration', (spacing, duration) => {
    expect(getMarkerAnimationDuration(spacing)).toBe(duration);
  },
);

test('frequent fixes arrive within 300ms and slow fixes never trail longer than 1s', () => {
  const frames = markerAnimationHarness();
  const props = { icon: {}, onSelect: jest.fn(), nowMs: 105000 };
  const { rerender, unmount } = render(<AnimatedBusMarker {...props} bus={animationBus()} />);
  try {
    rerender(<AnimatedBusMarker {...props} bus={animationBus(14.096)} />);
    frames.frame(400);
    frames.setClock(1000);
    rerender(<AnimatedBusMarker {...props} bus={animationBus(14.097)} />);
    frames.frame(1300);
    expect(screen.getByRole('button', { name: 'Marker 14.097,121.16' })).toBeInTheDocument();
    frames.setClock(13000);
    rerender(<AnimatedBusMarker {...props} bus={animationBus(14.098)} />);
    frames.frame(14000);
    expect(screen.getByRole('button', { name: 'Marker 14.098,121.16' })).toBeInTheDocument();
    expect(frames.pending.size).toBe(0);
  } finally { unmount(); frames.restore(); }
});

test.each([
  ['selected', { id: 'a', gps: { latitude: 14.1, longitude: 121.1 } }, [{ lat: 14.2, lng: 121.2 }], [14.1, 121.1]],
  ['multiple', null, [{ lat: 14.1, lng: 121.1 }, { lat: 14.2, lng: 121.2 }], null],
  ['single', null, [{ lat: 14.2, lng: 121.2 }], [14.2, 121.2]],
  ['fallback', null, [], null],
])('reset %s uses current fleet data, not the panned viewport', (_, selectedBus, visiblePoints, center) => {
  const routePoints = [{ lat: 14.05, lng: 121.05 }, { lat: 14.3, lng: 121.3 }];
  const props = { selectedBus, visiblePoints, routePoints, centerBusSignal: 0, centerAllSignal: 0, resetViewSignal: 0 };
  const target = getFleetResetTarget(selectedBus, visiblePoints, routePoints);
  const { rerender } = render(<MapViewportController {...props} />);
  rerender(<MapViewportController {...props} resetViewSignal={1} />);
  if (center) expect(mockLeafletMap.flyTo).toHaveBeenCalledWith(center, 14, expect.any(Object));
  else {
    expect(target.points).toEqual(visiblePoints.length > 1 ? visiblePoints : routePoints);
    expect(mockLeafletMap.flyToBounds).toHaveBeenCalledTimes(1);
  }
  const count = mockLeafletMap.flyTo.mock.calls.length + mockLeafletMap.flyToBounds.mock.calls.length;
  rerender(<MapViewportController {...props} resetViewSignal={1} resizeSignal="full-map-exit" />);
  expect(mockLeafletMap.flyTo.mock.calls.length + mockLeafletMap.flyToBounds.mock.calls.length).toBe(count);
});

test('reset focuses selected offline last-known fix and falls back from invalid selection', () => {
  const bus = { id: 'a', gps: { online: false, lastKnownPosition: { lat: 14.1, lng: 121.1, capturedAt: 100000 } } };
  expect(getFleetResetTarget(bus, []).center).toEqual([14.1, 121.1]);
  expect(getFleetResetTarget({ id: 'invalid', gps: { latitude: null, longitude: null } }, [{ lat: 14.2, lng: 121.2 }]).center).toEqual([14.2, 121.2]);
  const fallback = getFleetResetTarget(null, [{ lat: 91, lng: 0 }], []);
  expect(fallback.points.length).toBeGreaterThan(1);
  expect(fallback.points.every((point) => Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180)).toBe(true);
});

test.each(['fresh', 'mixed', 'stale', 'offline', 'null'])('two-bus %s markers retain independent identity and selection', (mode) => {
  const buses = [
    { id: 'a', status: 'active', gps: { latitude: 14.1, longitude: 121.1, online: true, updatedAt: 100000 } },
    { id: 'b', status: 'active', gps: { latitude: 14.2, longitude: 121.2, online: mode !== 'offline', updatedAt: mode === 'fresh' ? 100000 : 1000 } },
  ];
  if (mode === 'stale') buses[0].gps.updatedAt = 1000;
  if (mode === 'null') buses[1].gps.latitude = buses[1].gps.longitude = null;
  const onSelect = jest.fn();
  render(<ZoomAwareBusMarkers buses={buses.filter(isMarkerEligible)} selectedBusId="a" onSelect={onSelect} nowMs={105000} />);
  expect(screen.getAllByRole('button')).toHaveLength(mode === 'null' ? 1 : 2);
  expect(screen.getByRole('button', { name: 'Marker 14.1,121.1' })).toBeInTheDocument();
  if (mode !== 'null') {
    fireEvent.click(screen.getByRole('button', { name: 'Marker 14.2,121.2' }));
    expect(onSelect.mock.calls[0][0].id).toBe('b');
    const icon = createBusMarkerIcon(buses[1], false, 12, 105000);
    expect(icon.options.html).toContain(`data-gps-status="${mode === 'offline' ? 'Offline' : mode === 'fresh' ? 'Online' : 'Stale'}"`);
    if (mode !== 'fresh') expect(icon.options.html).toContain('centrabus-marker__status-cue');
    expect(icon.options.html).not.toContain('border-style:dashed');
  }
});

test('updating either keyed marker preserves the other marker even without plates', () => {
  const frames = markerAnimationHarness();
  const busA = animationBus(14.095);
  busA.id = 'a'; delete busA.plateNumber;
  const busB = { ...animationBus(14.2), id: 'b', plateNumber: undefined };
  const props = { selectedBusId: 'a', onSelect: jest.fn(), nowMs: 105000 };
  const { rerender, unmount } = render(<ZoomAwareBusMarkers {...props} buses={[busA, busB]} />);
  try {
    rerender(<ZoomAwareBusMarkers {...props} buses={[{ ...busA, gps: { ...busA.gps, latitude: 14.096 } }, busB]} />);
    frames.frame(400);
    expect(screen.getByRole('button', { name: 'Marker 14.2,121.16' })).toBeInTheDocument();
    rerender(<ZoomAwareBusMarkers {...props} buses={[{ ...busA, gps: { ...busA.gps, latitude: 14.096 } }, { ...busB, gps: { ...busB.gps, latitude: 14.201 } }]} />);
    frames.frame(800);
    expect(screen.getByRole('button', { name: 'Marker 14.096,121.16' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marker 14.201,121.16' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  } finally { unmount(); frames.restore(); }
});

test('missing, blank, boolean and out-of-range coordinates never create zero/world markers', () => {
  for (const latitude of [null, undefined, '', ' ', true, 91, Infinity]) {
    const bus = { id: 'invalid', gps: { latitude, longitude: 121.16 } };
    expect(getBusCoordinates(bus)).toBeNull();
    expect(isMarkerEligible(bus)).toBe(false);
  }
  expect(getBusCoordinates({ id: 'zero', gps: { latitude: 0, longitude: 0 } })).toEqual({ lat: 0, lng: 0 });
});

test('stale/offline callouts show last-known semantics and original capture age', () => {
  const bus = { id: 'a', status: 'active', plateNumber: 'TEST', gps: { latitude: null, longitude: null, gpsUpdatedAt: 200000, online: true, lastKnownPosition: { lat: 14.1, lng: 121.1, capturedAt: 100000 } } };
  expect(getMarkerGpsFreshness(bus, 200000)).toMatchObject({ status: 'Stale', ageMs: 100000 });
  const { rerender } = render(<BusMarkerCallout bus={bus} nowMs={200000} />);
  expect(screen.getByText('Last-known GPS position')).toBeInTheDocument();
  expect(screen.getByText('Stale')).toBeInTheDocument();
  expect(screen.getByText('14.1, 121.1')).toBeInTheDocument();
  rerender(<BusMarkerCallout bus={{ ...bus, gps: { ...bus.gps, online: false } }} nowMs={200000} />);
  expect(screen.getByText('Offline')).toBeInTheDocument();
});

const toastAlert = { id: 'route-deviation-a', busId: 'a', busNumber: 'a', category: 'Route', title: 'Route Deviation Detected', severity: 'Critical', workflowStatus: 'New', timestampMs: 100000, description: 'Verbose details stay in Alert Center' };

test('toast deduplicates continuing deviations, stays dismissed and permits material changes/recurrence', () => {
  const { result, rerender } = renderHook(({ alerts }) => useAlertNotification(alerts), { initialProps: { alerts: [toastAlert] } });
  expect(result.current.popupAlertId).toBe(toastAlert.id);
  act(() => result.current.dismiss());
  rerender({ alerts: [{ ...toastAlert, timestampMs: 101000, description: 'Distance changed on next telemetry' }] });
  expect(result.current.popupAlertId).toBeNull();
  rerender({ alerts: [{ ...toastAlert, severity: 'Warning' }] });
  expect(result.current.popupAlertId).toBe(toastAlert.id);
  act(() => result.current.dismiss());
  rerender({ alerts: [] });
  rerender({ alerts: [toastAlert] });
  expect(result.current.popupAlertId).toBe(toastAlert.id);
});

test('compact critical toast retains severity/actions and dismissal leaves Alert Center intact', () => {
  function Harness() {
    const { popupAlertId, dismiss } = useAlertNotification([toastAlert]);
    return <>{popupAlertId && <AlertNotification alert={toastAlert} buses={[{ id: 'a', plateNumber: 'TEST' }]} onDismiss={dismiss} onReview={jest.fn()} onViewMap={jest.fn()} onAcknowledge={jest.fn()} />}<AlertsPage alerts={[toastAlert]} buses={[{ id: 'a', plateNumber: 'TEST' }]} onUpdateAlert={jest.fn()} /></>;
  }
  render(<Harness />);
  const toast = screen.getByRole('alert');
  expect(toast).toHaveClass('max-w-[320px]');
  expect(within(toast).getByText('Critical')).toBeInTheDocument();
  expect(within(toast).queryByText(toastAlert.description)).not.toBeInTheDocument();
  for (const action of ['Review Alert', 'Acknowledge', 'View on Map']) expect(within(toast).getByRole('button', { name: action })).toBeInTheDocument();
  fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss notification' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText(toastAlert.title)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  expect(screen.getByText(toastAlert.description)).toBeInTheDocument();
});

test('updated alert replaces toast content in place and keeps every action functional', () => {
  const onReview = jest.fn(), onViewMap = jest.fn(), onAcknowledge = jest.fn(), onDismiss = jest.fn();
  const props = { buses: [{ id: 'a', plateNumber: 'TEST' }], onReview, onViewMap, onAcknowledge, onDismiss };
  const { rerender } = render(<AlertNotification {...props} alert={toastAlert} />);
  rerender(<AlertNotification {...props} alert={{ ...toastAlert, title: 'Updated critical condition', timestampMs: 101000 }} />);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByText('Updated critical condition')).toBeInTheDocument();
  expect(screen.queryByText(toastAlert.title)).not.toBeInTheDocument();
  for (const action of ['Review Alert', 'View on Map', 'Acknowledge', 'Dismiss notification']) fireEvent.click(screen.getByRole('button', { name: action }));
  for (const handler of [onReview, onViewMap, onAcknowledge, onDismiss]) expect(handler).toHaveBeenCalledTimes(1);
});

test('initial fleet framing runs once and ignores subsequent GPS coordinate updates', async () => {
  const initialBus = { id: 'viewport-bus', gps: { latitude: 14.095, longitude: 121.16 } };
  const { rerender } = render(<FitFleetBounds buses={[initialBus]} />);
  await waitFor(() => expect(mockLeafletMap.setView).toHaveBeenCalledTimes(1));

  rerender(<FitFleetBounds buses={[{ ...initialBus, gps: { latitude: 14.096, longitude: 121.161 } }]} />);
  expect(mockLeafletMap.setView).toHaveBeenCalledTimes(1);
  expect(mockLeafletMap.fitBounds).not.toHaveBeenCalled();
});

test.each(['unmount', 'unload'])('initial fleet frame ignores late callbacks after %s', (mode) => {
  const frames = markerAnimationHarness();
  const { unmount } = render(<FitFleetBounds buses={[animationBus()]} />);
  try {
    const late = frames.pending.get(0);
    if (mode === 'unmount') unmount();
    else act(() => mockLeafletMap.on.mock.calls.find(([name]) => name === 'unload')[1]());
    expect(frames.pending.size).toBe(0);
    act(() => late(1000));
    expect(mockLeafletMap.invalidateSize).not.toHaveBeenCalled();
    expect(mockLeafletMap.setView).not.toHaveBeenCalled();
  } finally { unmount(); frames.restore(); }
});

test('explicit map focus controls use current data once per user signal', () => {
  const initialProps = {
    selectedBus: { id: 'focus-bus', gps: { latitude: 14.095, longitude: 121.16 } },
    visiblePoints: [{ lat: 14.095, lng: 121.16 }],
    routePoints: [{ lat: 14.09, lng: 121.15 }, { lat: 14.1, lng: 121.17 }],
    centerBusSignal: 0,
    centerAllSignal: 0,
    resetViewSignal: 0,
    resizeSignal: 'initial',
  };
  const { rerender } = render(<MapViewportController {...initialProps} />);
  rerender(<MapViewportController {...initialProps} centerBusSignal={1} />);
  expect(mockLeafletMap.flyTo).toHaveBeenCalledTimes(1);

  rerender(<MapViewportController {...initialProps} centerBusSignal={1} selectedBus={{ id: 'focus-bus', gps: { latitude: 14.096, longitude: 121.161 } }} />);
  expect(mockLeafletMap.flyTo).toHaveBeenCalledTimes(1);
  rerender(<MapViewportController {...initialProps} centerBusSignal={2} selectedBus={{ id: 'focus-bus', gps: { latitude: 14.096, longitude: 121.161 } }} />);
  expect(mockLeafletMap.flyTo).toHaveBeenCalledTimes(2);

  rerender(<MapViewportController {...initialProps} centerBusSignal={2} centerAllSignal={1} />);
  expect(mockLeafletMap.flyTo).toHaveBeenCalledTimes(3);
  rerender(<MapViewportController {...initialProps} centerBusSignal={2} centerAllSignal={1} visiblePoints={[{ lat: 14.097, lng: 121.162 }]} />);
  expect(mockLeafletMap.flyTo).toHaveBeenCalledTimes(3);
  rerender(<MapViewportController {...initialProps} centerBusSignal={2} centerAllSignal={1} resetViewSignal={1} />);
  expect(mockLeafletMap.flyTo).toHaveBeenCalledTimes(4);
  expect(mockLeafletMap.flyToBounds).not.toHaveBeenCalled();
});

test.each(['unmount', 'unload'])('map resize work is cancelled on %s and late callbacks cannot touch a removed pane', (mode) => {
  const frames = [];
  const requestFrame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancelFrame = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const originalResizeObserver = global.ResizeObserver;
  const container = document.createElement('div');
  let resizeCallback;
  const disconnect = jest.fn();
  global.ResizeObserver = jest.fn((callback) => {
    resizeCallback = callback;
    return { observe: jest.fn(), disconnect };
  });
  const originalGetContainer = mockLeafletMap.getContainer;
  mockLeafletMap.getContainer = () => container;
  let unmount;
  try {
    ({ unmount } = render(<MapViewportController visiblePoints={[]} routePoints={[]} resizeSignal="initial" />));
    act(() => frames.shift()());
    expect(mockLeafletMap.invalidateSize).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new Event('resize')));
    const lateFrame = frames[0];
    const unload = mockLeafletMap.on.mock.calls.find(([name]) => name === 'unload')[1];
    if (mode === 'unmount') unmount();
    else act(() => unload());
    expect(disconnect).toHaveBeenCalled();
    expect(cancelFrame).toHaveBeenCalled();
    act(() => {
      lateFrame();
      resizeCallback();
      window.dispatchEvent(new Event('resize'));
    });
    expect(mockLeafletMap.invalidateSize).toHaveBeenCalledTimes(1);
    expect(requestFrame).toHaveBeenCalledTimes(2);
  } finally {
    unmount?.();
    mockLeafletMap.getContainer = originalGetContainer;
    global.ResizeObserver = originalResizeObserver;
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  }
});

test('overview requires explicit selection and never falls back after deselection or bus removal', () => {
  expect(getValidSelectedBusId(overviewBuses, null)).toBeNull();
  expect(getValidSelectedBusId(overviewBuses, 'removed')).toBeNull();
  expect(getValidSelectedBusId(overviewBuses, 'bus-b')).toBe('bus-b');
});

test('overview marker selection reveals the correct live details and close clears them', async () => {
  const onNavigate = jest.fn();
  render(<OverviewHarness onNavigate={onNavigate} />);
  const panel = within(screen.getByRole('complementary', { name: 'Selected vehicle details' }));
  expect(panel.getByText('Select a bus on the map to view details')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(panel.queryByText('Vehicle Condition')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Center selected bus' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Marker 14.095,121.16' }));
  expect(panel.getByText('Bus ID: bus-a')).toBeInTheDocument();
  expect(panel.getByText('Route A')).toBeInTheDocument();
  expect(panel.getByText('35 km/h')).toBeInTheDocument();
  expect(panel.getByRole('heading', { name: 'Route Monitoring' })).toBeInTheDocument();
  expect(panel.getByText('On Route')).toHaveAttribute('data-route-tone', 'success');
  expect(panel.getByText('28 m')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Center selected bus' })).toBeEnabled();
  expect(panel.getByText('1 gauge requires attention')).toBeInTheDocument();
  expect(panel.getByText('Fuel Level')).toBeInTheDocument();
  expect(panel.queryByText('Water Temperature')).not.toBeInTheDocument();
  fireEvent.click(panel.getByRole('button', { name: 'View bus details' }));
  expect(onNavigate).toHaveBeenLastCalledWith('vehicle-condition');
  fireEvent.click(panel.getByRole('button', { name: 'View condition' }));
  expect(onNavigate).toHaveBeenLastCalledWith('vehicle-condition');
  fireEvent.click(panel.getByRole('button', { name: 'Close vehicle details' }));
  expect(panel.getByText('Select a bus on the map to view details')).toBeInTheDocument();
  expect(panel.queryByRole('button', { name: 'View bus details' })).not.toBeInTheDocument();
  await waitFor(() => expect(panel.queryByText('Bus ID: bus-a')).not.toBeInTheDocument());
  expect(panel.queryByText('Vehicle Condition')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Fleet map' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'View Full Map' }));
  expect(onNavigate).toHaveBeenLastCalledWith('map');
});

test('overview keeps its map and details slots stable through selection without scrolling the page', async () => {
  const scrollYDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY');
  const initialScrollY = 365;
  const originalScrollTo = window.scrollTo;
  const scrollTo = jest.fn();
  Object.defineProperty(window, 'scrollY', { configurable: true, value: initialScrollY });
  window.scrollTo = scrollTo;

  try {
    render(<OverviewHarness />);
    const layout = screen.getByTestId('overview-map-details-layout');
    const mapRegion = screen.getByRole('region', { name: 'Fleet map' });
    const mapCard = mapRegion.querySelector('.map-card');
    const panel = within(screen.getByRole('complementary', { name: 'Selected vehicle details' }));
    const detailsScroll = screen.getByTestId('overview-details-scroll');
    const mapFocus = jest.spyOn(mapRegion, 'focus');

    expect(layout).toHaveClass('overview-map-details-layout');
    expect(mapRegion).toContainElement(mapCard);
    expect(detailsScroll).toHaveClass('lg:overflow-y-auto');

    fireEvent.click(screen.getByRole('button', { name: 'Marker 14.095,121.16' }));
    expect(panel.getByText('Bus ID: bus-a')).toBeInTheDocument();
    expect(screen.getByTestId('overview-map-details-layout')).toBe(layout);
    expect(screen.getByRole('region', { name: 'Fleet map' })).toBe(mapRegion);
    expect(mapRegion.querySelector('.map-card')).toBe(mapCard);

    fireEvent.click(screen.getByRole('button', { name: 'Marker 14.1,121.17' }));
    expect(panel.getByText('Bus ID: bus-b')).toBeInTheDocument();
    expect(panel.queryByText('Bus ID: bus-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('overview-details-scroll')).toBe(detailsScroll);

    fireEvent.click(screen.getByRole('button', { name: 'Close vehicle details' }));
    await waitFor(() => expect(panel.queryByText('Bus ID: bus-b')).not.toBeInTheDocument());
    expect(screen.getByText('Select a bus on the map to view details')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Fleet map' })).toBe(mapRegion);
    expect(window.scrollY).toBe(initialScrollY);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(mapFocus).toHaveBeenLastCalledWith({ preventScroll: true });
  } finally {
    window.scrollTo = originalScrollTo;
    if (scrollYDescriptor) Object.defineProperty(window, 'scrollY', scrollYDescriptor);
    else delete window.scrollY;
  }
});

test('KPI row stays stable through selection, count and GPS changes while Diagnostics is absent', async () => {
  const { rerender } = render(<OverviewHarness includeKpis includeGpsDiagnosticsForTest={false} />);
  const row = screen.getByTestId('overview-kpi-summary');
  const layout = screen.getByTestId('overview-map-details-layout');
  const cards = within(row).getAllByRole('button');
  const mapRegion = screen.getByRole('region', { name: 'Fleet map' });
  const detailPanel = within(screen.getByRole('complementary', { name: 'Selected vehicle details' }));

  expect(row).toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-3');
  expect(cards).toHaveLength(3);
  expect(cards.map((card) => card.className)).toEqual(expect.arrayContaining([
    expect.stringContaining('summary-card-1'),
    expect.stringContaining('summary-card-2'),
    expect.stringContaining('summary-card-3'),
  ]));
  expect(screen.getByRole('region', { name: 'System Health' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'GPS Diagnostics' })).not.toBeInTheDocument();
  expect(layout.nextElementSibling).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Marker 14.095,121.16' }));
  expect(detailPanel.getByText('Bus ID: bus-a')).toBeInTheDocument();
  expect(screen.getByTestId('overview-kpi-summary')).toBe(row);
  expect(within(row).getAllByRole('button')).toEqual(cards);
  expect(screen.getByRole('region', { name: 'Fleet map' })).toBe(mapRegion);

  const changedBuses = overviewBuses.map((bus) => bus.id === 'bus-a'
    ? { ...bus, gps: { ...bus.gps, online: false, updatedAt: 100000 } }
    : bus);
  const changedCounts = { ...overviewKpiCounts, activeBusCount: 3, vehicleIssueCount: 7, warningIssueCount: 6 };
  rerender(<OverviewHarness buses={changedBuses} includeKpis kpiCounts={changedCounts} includeGpsDiagnosticsForTest={false} />);
  expect(detailPanel.getByText(/Offline/)).toBeInTheDocument();
  expect(cards[0]).toHaveTextContent('3');
  expect(cards[1]).toHaveTextContent('7');
  expect(within(row).getAllByRole('button')).toEqual(cards);

  fireEvent.click(screen.getByRole('button', { name: 'Marker 14.1,121.17' }));
  expect(detailPanel.getByText('Bus ID: bus-b')).toBeInTheDocument();
  expect(within(row).getAllByRole('button')).toEqual(cards);
  fireEvent.click(screen.getByRole('button', { name: 'Close vehicle details' }));
  await waitFor(() => expect(detailPanel.queryByText('Bus ID: bus-b')).not.toBeInTheDocument());
  expect(screen.getByTestId('overview-map-details-layout')).toBe(layout);
  expect(within(row).getAllByRole('button')).toEqual(cards);
  expect(layout.nextElementSibling).toBeNull();
});

test('GPS Diagnostics remains rendered by default pending dual-device and drive acceptance', () => {
  render(<OverviewHarness />);
  expect(screen.getByRole('heading', { name: 'GPS Diagnostics' })).toBeInTheDocument();
});

test('KPI desktop sizing is fixed and long issue summaries stay readable without growing the row', () => {
  const onNavigate = jest.fn();
  const { rerender } = render(<SummaryCards counts={overviewKpiCounts} busesLoading={false} onNavigate={onNavigate} />);
  const row = screen.getByTestId('overview-kpi-summary');
  const cards = within(row).getAllByRole('button');
  const issueSummary = cards[1].querySelector('.summary-card-detail');

  expect(cards).toHaveLength(3);
  expect(cards.every((card) => card.classList.contains('summary-card'))).toBe(true);
  expect(issueSummary).toHaveTextContent('1 critical');
  expect(issueSummary).toHaveTextContent('5 warnings');
  expect(issueSummary).toHaveAttribute('title', '1 critical · 5 warnings');

  const longCounts = {
    ...overviewKpiCounts,
    vehicleIssueCount: 999999999,
    warningIssueCount: 999999999,
    criticalIssueCount: 999999999,
  };
  rerender(<SummaryCards counts={longCounts} busesLoading={false} onNavigate={onNavigate} />);
  expect(screen.getByTestId('overview-kpi-summary')).toBe(row);
  expect(within(row).getAllByRole('button')).toEqual(cards);
  expect(issueSummary).toHaveAttribute('title', '999999999 critical · 999999999 warnings');

  const css = readFileSync(join(__dirname, 'index.css'), 'utf8');
  const desktopKpiStart = css.indexOf('.dashboard-summary {\n    grid-auto-rows: 92px;');
  const desktopMapRules = css.indexOf('.overview-map-details-layout {', desktopKpiStart);
  const desktopKpiCss = css.slice(desktopKpiStart, desktopMapRules);
  const responsiveSummaryRule = [...css.matchAll(/\.summary-card-detail\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .find((rule) => rule.includes('-webkit-line-clamp')) || '';
  expect(desktopKpiStart).toBeGreaterThan(-1);
  expect(desktopMapRules).toBeGreaterThan(desktopKpiStart);
  expect(responsiveSummaryRule).toMatch(/-webkit-line-clamp:\s*2;/);
  expect(responsiveSummaryRule).toMatch(/overflow:\s*hidden;/);
  expect(desktopKpiCss).toMatch(/height:\s*92px;/);
  expect(desktopKpiCss).toMatch(/min-height:\s*92px;/);
  expect(desktopKpiCss).toMatch(/max-height:\s*92px;/);
  expect(desktopKpiCss).toMatch(/\.summary-card-detail\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
});

test('coincident bus chips share one tail at the real coordinate and each click selects that exact bus', () => {
  mockLeafletMap.latLngToContainerPoint = ([lat, lng]) => ({ x: lng * 10000, y: lat * 10000 });
  mockLeafletMap.containerPointToLatLng = ({ x, y }) => ({ lat: y / 10000, lng: x / 10000 });
  const buses = [
    { ...overviewBuses[0], id: 'bus-a', plateNumber: 'ABC 234' },
    { ...overviewBuses[1], id: 'bus-b', plateNumber: 'CRK 160', gps: { ...overviewBuses[1].gps, latitude: overviewBuses[0].gps.latitude, longitude: overviewBuses[0].gps.longitude } },
  ];
  try {
    render(<OverviewHarness buses={buses} />);
    const panel = within(screen.getByRole('complementary', { name: 'Selected vehicle details' }));
    const markers = screen.getAllByRole('button', { name: /Select bus / });
    expect(markers).toHaveLength(2);
    const group = screen.getByTestId('shared-bus-marker');
    expect(group).toHaveAttribute('data-position', '14.095,121.16');
    expect(screen.queryByTestId('bus-marker-connector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bus-marker-connector-halo')).not.toBeInTheDocument();
    expect(group.querySelectorAll('.centrabus-marker-group__tail')).toHaveLength(1);
    expect(group.querySelector('.centrabus-marker__pointer')).toBeNull();
    expect(screen.queryByTestId('bus-gps-anchor')).not.toBeInTheDocument();
    expect(markers[0]).toHaveAccessibleName('Select bus ABC 234');
    expect(markers[1]).toHaveAccessibleName('Select bus CRK 160');

    fireEvent.click(markers[1]);
    expect(panel.getByText('Bus ID: bus-b')).toBeInTheDocument();
    expect(panel.queryByRole('region', { name: 'Overlapping buses' })).not.toBeInTheDocument();
    expect(group).toHaveAttribute('data-marker-z-index', '1000');
    expect(screen.getByRole('button', { name: 'Select bus CRK 160' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Select bus ABC 234' }));
    expect(panel.getByText('Bus ID: bus-a')).toBeInTheDocument();
    expect(screen.getByTestId('shared-bus-marker')).toBe(group);
    expect(screen.getByRole('button', { name: 'Select bus ABC 234' })).toHaveAttribute('aria-pressed', 'true');
  } finally {
    delete mockLeafletMap.latLngToContainerPoint;
    delete mockLeafletMap.containerPointToLatLng;
  }
});

test('overlapping buses with distinct 30px GPS anchors get two true-position dots and integrated pins, not line layers', () => {
  const projection = createMarkerProjectionMap(10000);
  mockLeafletMap.latLngToContainerPoint = projection.latLngToContainerPoint;
  mockLeafletMap.containerPointToLatLng = projection.containerPointToLatLng;
  const buses = [
    { id: 'a', gps: { latitude: 0, longitude: 0, online: false } },
    { id: 'b', gps: { latitude: 0, longitude: 0.003, online: false } },
  ];
  const { rerender, unmount } = render(<ZoomAwareBusMarkers buses={buses} selectedBusId={null} onSelect={jest.fn()} nowMs={105000} />);
  try {
    const markers = screen.getAllByRole('button');
    const anchors = screen.getAllByTestId('bus-gps-anchor');
    expect(screen.queryByTestId('bus-marker-connector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bus-marker-connector-halo')).not.toBeInTheDocument();
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toHaveAttribute('data-position', '0,0');
    expect(anchors[1]).toHaveAttribute('data-position', '0,0.003');
    expect(markers.every((marker) => marker.getAttribute('data-icon-html').includes('centrabus-marker__pointer'))).toBe(true);
    expect(markers[0]).not.toHaveAccessibleName('Marker 0,0');
    expect(markers[1]).not.toHaveAccessibleName('Marker 0,0.003');

    // Tiny GPS changes and selection preserve the keyed bus objects and sides.
    const updated = buses.map((bus) => ({ ...bus, gps: { ...bus.gps, latitude: 0.00001 } }));
    rerender(<ZoomAwareBusMarkers buses={updated} selectedBusId="a" onSelect={jest.fn()} nowMs={105000} />);
    expect(screen.getAllByRole('button')).toEqual(markers);
    expect(markers[0]).toHaveAttribute('data-marker-z-index', '1000');
    expect(screen.getAllByTestId('bus-gps-anchor')[1]).toHaveAttribute('data-position', '0.00001,0.003');
  } finally {
    unmount();
    delete mockLeafletMap.latLngToContainerPoint;
    delete mockLeafletMap.containerPointToLatLng;
  }
});

test('four coincident buses share one composite key/tail with no separate GPS dots', () => {
  const buses = ['a', 'b', 'c', 'd'].map((id) => ({ id, gps: { latitude: 0, longitude: 0 } }));
  const offsets = getNearbyBusMarkerOffsets(buses, createMarkerProjectionMap(10000));
  expect(offsets.size).toBe(4);
  expect([...offsets.values()].filter((offset) => offset.showAnchor)).toHaveLength(0);
  expect(new Set([...offsets.values()].map((offset) => offset.sharedGroupKey)).size).toBe(1);
  expect(new Set([...offsets.values()].map(({ x, y }) => `${x},${y}`)).size).toBe(4);
  expect([...offsets.values()].every(({ x, y }) => Math.abs(x) <= 30 && Math.abs(y) <= 50)).toBe(true);
});

test('nearby screen-overlapping markers fan out and retain stale/offline marker styling', () => {
  mockLeafletMap.latLngToContainerPoint = ([lat, lng]) => ({ x: lng * 10000, y: lat * 10000 });
  mockLeafletMap.containerPointToLatLng = ({ x, y }) => ({ lat: y / 10000, lng: x / 10000 });
  const buses = [
    { id: 'stale-bus', plateNumber: 'STALE', status: 'active', gps: { latitude: 0, longitude: 0, online: true, updatedAt: 1000 } },
    { id: 'offline-bus', plateNumber: 'OFFLINE', status: 'active', gps: { latitude: 0, longitude: 0.001, online: false, updatedAt: 100000 } },
  ];
  try {
    render(<ZoomAwareBusMarkers buses={buses} selectedBusId="stale-bus" onSelect={jest.fn()} nowMs={105000} />);
    const markers = screen.getAllByRole('button');
    expect(markers).toHaveLength(2);
    expect(markers[0]).not.toHaveAccessibleName('Marker 0,0');
    expect(markers[1]).not.toHaveAccessibleName('Marker 0,0.001');
    expect(createBusMarkerIcon(buses[0], false, 12, 105000).options.html).toContain('data-gps-status="Stale"');
    expect(createBusMarkerIcon(buses[0], false, 12, 105000).options.html).toContain('centrabus-marker__status-cue');
    expect(createBusMarkerIcon(buses[1], false, 12, 105000).options.html).toContain('data-gps-status="Offline"');
    expect(createBusMarkerIcon(buses[1], false, 12, 105000).options.html).toContain('centrabus-marker__status-cue');
  } finally {
    delete mockLeafletMap.latLngToContainerPoint;
    delete mockLeafletMap.containerPointToLatLng;
  }
});

test('Buses control opens and closes with a complete, live fleet status list', () => {
  const buses = [
    overviewBuses[0],
    { ...overviewBuses[1], gps: { ...overviewBuses[1].gps, updatedAt: 1000 } },
    { id: 'bus-c', busCode: 'YARD 003', status: 'active', gps: { latitude: 14.11, longitude: 121.18, online: false, updatedAt: 1000 } },
    { id: 'bus-no-fix', busCode: 'YARD 004', status: 'inactive', gps: null },
    { id: 'archived-bus', plateNumber: 'ARCHIVED', isArchived: true, gps: overviewBuses[0].gps },
  ];
  const { rerender } = render(<OverviewHarness buses={buses} />);
  const trigger = screen.getByRole('button', { name: /Buses/ });

  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('region', { name: 'Available buses' })).not.toBeInTheDocument();
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('region', { name: 'Available buses' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Select bus ABC 234, GPS Online' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Select bus CRK 160, GPS Stale' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Select bus YARD 003, GPS Offline' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Select bus YARD 004, GPS No Location' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /ARCHIVED/ })).not.toBeInTheDocument();

  const onlineBuses = buses.map((bus) => bus.id === 'bus-b' ? { ...bus, gps: { ...bus.gps, updatedAt: 100000 } } : bus);
  rerender(<OverviewHarness buses={onlineBuses} />);
  expect(screen.getByRole('button', { name: 'Select bus CRK 160, GPS Online' })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('button', { name: /Buses/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('region', { name: 'Available buses' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Buses/ }));
  fireEvent.pointerDown(screen.getByRole('region', { name: 'Fleet map' }));
  expect(screen.getByRole('button', { name: /Buses/ })).toHaveAttribute('aria-expanded', 'false');
});

test('fleet selector can select A then B, pin the selected popup and preserve both live markers', () => {
  const { rerender } = render(<OverviewHarness />);
  const panel = within(screen.getByRole('complementary', { name: 'Selected vehicle details' }));
  const markerA = screen.getByRole('button', { name: 'Marker 14.095,121.16' });
  const markerB = screen.getByRole('button', { name: 'Marker 14.1,121.17' });
  const leafletPositionA = { x: 100, y: 200 };
  markerA._leaflet_pos = leafletPositionA;

  fireEvent.click(screen.getByRole('button', { name: /Buses/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Select bus ABC 234, GPS Online' }));
  expect(panel.getByText('Bus ID: bus-a')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Buses/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('tooltip')).toHaveAttribute('data-pinned', 'true');
  expect(markerA).toHaveAttribute('data-marker-z-index', '1000');

  fireEvent.click(screen.getByRole('button', { name: /Buses/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Select bus CRK 160, GPS Online' }));
  expect(panel.getByText('Bus ID: bus-b')).toBeInTheDocument();
  expect(panel.queryByText('Bus ID: bus-a')).not.toBeInTheDocument();
  expect(screen.getAllByRole('tooltip').filter((card) => card.dataset.pinned === 'true')).toHaveLength(1);
  expect(within(screen.getByRole('tooltip')).getByText('CRK 160')).toBeInTheDocument();
  expect(markerA).toBe(screen.getByRole('button', { name: 'Marker 14.095,121.16' }));
  expect(markerB).toBe(screen.getByRole('button', { name: 'Marker 14.1,121.17' }));
  expect(markerB).toHaveAttribute('data-marker-z-index', '1000');
  expect(markerA._leaflet_pos).toBe(leafletPositionA);

  const liveUpdates = overviewBuses.map((bus) => bus.id === 'bus-a'
    ? { ...bus, gps: { ...bus.gps, speed: 0, rawSpeedKmh: 9 } }
    : { ...bus, gps: { ...bus.gps, speed: 0, rawSpeedKmh: 14 } });
  rerender(<OverviewHarness buses={liveUpdates} />);
  expect(panel.getByText('Bus ID: bus-b')).toBeInTheDocument();
  expect(panel.getByText('14 km/h')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marker 14.095,121.16' })).toBe(markerA);
  expect(screen.getByRole('button', { name: 'Marker 14.1,121.17' })).toBe(markerB);
  expect(within(screen.getByRole('tooltip')).getByText('CRK 160')).toBeInTheDocument();
});

test('plate-less stale bus remains selectable and pins its retained last-known marker', () => {
  const staleBus = { id: 'bus-yard', busCode: 'YARD 007', status: 'active', gps: { latitude: 14.12, longitude: 121.19, speed: 0, online: true, updatedAt: 1000 } };
  render(<OverviewHarness buses={[staleBus]} />);
  const panel = within(screen.getByRole('complementary', { name: 'Selected vehicle details' }));
  fireEvent.click(screen.getByRole('button', { name: /Buses/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Select bus YARD 007, GPS Stale' }));

  expect(panel.getByText('Bus ID: bus-yard')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marker 14.12,121.19' })).toHaveAttribute('data-marker-z-index', '1000');
  const popup = screen.getByRole('tooltip');
  expect(popup).toHaveAttribute('data-pinned', 'true');
  expect(within(popup).getByText('Stale')).toBeInTheDocument();
  expect(within(popup).getByText('Last-known GPS position')).toBeInTheDocument();
});

test('no-location bus can be selected without creating a marker or moving the map', () => {
  const noFixBus = { id: 'bus-no-fix', busCode: 'YARD 004', status: 'inactive', gps: null };
  mockLeafletMap.flyTo.mockClear();
  mockLeafletMap.flyToBounds.mockClear();
  const { rerender } = render(<OverviewHarness buses={[noFixBus]} />);
  const panel = within(screen.getByRole('complementary', { name: 'Selected vehicle details' }));
  fireEvent.click(screen.getByRole('button', { name: /Buses/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Select bus YARD 004, GPS No Location' }));

  expect(panel.getByText('Bus ID: bus-no-fix')).toBeInTheDocument();
  expect(panel.getByText('No GPS Data')).toBeInTheDocument();
  expect(panel.getByText('Location').parentElement).toHaveTextContent('Unavailable');
  expect(screen.queryByRole('button', { name: /^Marker / })).not.toBeInTheDocument();
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(mockLeafletMap.flyTo).not.toHaveBeenCalled();
  expect(mockLeafletMap.flyToBounds).not.toHaveBeenCalled();

  const firstFix = { ...noFixBus, gps: { latitude: 14.13, longitude: 121.2, speed: 0, online: true, updatedAt: 105000 } };
  rerender(<OverviewHarness buses={[firstFix]} />);
  expect(panel.getByText('Bus ID: bus-no-fix')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marker 14.13,121.2' })).toHaveAttribute('data-marker-z-index', '1000');
  expect(screen.getByRole('tooltip')).toHaveAttribute('data-pinned', 'true');
});

test('selector-based selection keeps Reset and Center All map actions working', () => {
  mockLeafletMap.flyTo.mockClear();
  mockLeafletMap.flyToBounds.mockClear();
  render(<OverviewHarness />);
  fireEvent.click(screen.getByRole('button', { name: /Buses/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Select bus CRK 160, GPS Online' }));

  mockLeafletMap.flyTo.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Reset map view' }));
  expect(mockLeafletMap.flyTo).toHaveBeenCalledWith([14.1, 121.17], 14, expect.any(Object));

  mockLeafletMap.flyToBounds.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Center all buses' }));
  expect(mockLeafletMap.flyToBounds).toHaveBeenCalledTimes(1);
});

test('fleet selector stays viewport-bounded and cleans up keyboard/outside listeners on unmount', () => {
  const removeListener = jest.spyOn(document, 'removeEventListener');
  const { unmount } = render(<OverviewHarness />);
  fireEvent.click(screen.getByRole('button', { name: /Buses/ }));
  const popover = screen.getByRole('region', { name: 'Available buses' });
  expect(popover).toHaveClass('fleet-bus-selector-popover');
  expect(within(popover).getByRole('button', { name: 'Select bus ABC 234, GPS Online' })).toHaveClass('min-h-[52px]');
  const css = readFileSync(join(__dirname, 'index.css'), 'utf8');
  expect(css).toMatch(/\.fleet-bus-selector-popover\s*\{[^}]*width:\s*min\(20rem,\s*calc\(100vw\s*-\s*2rem\)\);[^}]*max-height:\s*min\(60vh,\s*22rem\);/);
  unmount();
  expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  expect(removeListener).toHaveBeenCalledWith('pointerdown', expect.any(Function));
  removeListener.mockRestore();
});

test('clicking the selected overview marker toggles and locks the detail panel', async () => {
  render(<OverviewHarness />);
  const panel = within(screen.getByRole('complementary', { name: 'Selected vehicle details' }));
  const marker = screen.getByRole('button', { name: 'Marker 14.095,121.16' });

  fireEvent.click(marker);
  expect(panel.getByText('Bus ID: bus-a')).toBeInTheDocument();
  expect(marker).toBeInTheDocument();

  fireEvent.click(marker);
  expect(panel.getByText('Select a bus on the map to view details')).toBeInTheDocument();
  await waitFor(() => expect(panel.queryByText('Bus ID: bus-a')).not.toBeInTheDocument());
});

test('overview markers switch buses and follow live conditions without stale values', () => {
  const { rerender } = render(<OverviewHarness />);
  const panel = within(screen.getByRole('complementary', { name: 'Selected vehicle details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Marker 14.095,121.16' }));
  fireEvent.click(screen.getByRole('button', { name: 'Marker 14.1,121.17' }));
  expect(panel.getAllByRole('heading', { name: 'Active Bus' })).toHaveLength(1);
  expect(panel.getByText('Bus ID: bus-b')).toBeInTheDocument();
  expect(panel.queryByText('Route A')).not.toBeInTheDocument();
  expect(panel.getByText('Possible Deviation')).toHaveAttribute('data-route-tone', 'warning');
  expect(panel.getByText('10.46 km')).toBeInTheDocument();
  expect(panel.getByText('All systems normal')).toBeInTheDocument();
  expect(panel.queryByText('Fuel Level')).not.toBeInTheDocument();
  const updatedBuses = overviewBuses.map((bus) => bus.id === 'bus-b' ? { ...bus, gps: { ...bus.gps, speed: 0, rawSpeedKmh: 12 }, gaugeReadings: [{ gaugeKey: 'fuel', label: 'Fuel Level', status: 'Critical', estimatedPercent: 5 }] } : bus);
  rerender(<OverviewHarness buses={updatedBuses} />);
  expect(panel.getByText('12 km/h')).toBeInTheDocument();
  expect(panel.getByText('Fuel Level')).toBeInTheDocument();
  expect(panel.queryByText('All systems normal')).not.toBeInTheDocument();
  rerender(<OverviewHarness buses={[overviewBuses[0]]} />);
  expect(panel.getByText('Select a bus on the map to view details')).toBeInTheDocument();
  expect(panel.queryByText('Bus ID: bus-b')).not.toBeInTheDocument();
});

test('overview does not claim normal conditions for a bus without sensor readings', () => {
  render(<OverviewHarness buses={[{ ...overviewBuses[0], gaugeReadings: [] }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Marker 14.095,121.16' }));
  expect(screen.queryByText('All systems normal')).not.toBeInTheDocument();
  expect(screen.getByText(/Awaiting validated condition data/)).toBeInTheDocument();
});

test('selecting another marker during closing keeps the new bus open', async () => {
  render(<OverviewHarness />);
  const panel = within(screen.getByRole('complementary', { name: 'Selected vehicle details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Marker 14.095,121.16' }));
  fireEvent.click(panel.getByRole('button', { name: 'Close vehicle details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Marker 14.1,121.17' }));
  expect(panel.getByText('Bus ID: bus-b')).toBeInTheDocument();
  expect(panel.queryByText('Bus ID: bus-a')).not.toBeInTheDocument();
  expect(panel.getByRole('button', { name: 'Close vehicle details' })).toBeEnabled();
  // Complete another exit to verify timer cleanup after rapid reselection.
  fireEvent.click(panel.getByRole('button', { name: 'Close vehicle details' }));
  await waitFor(() => expect(panel.queryByText('Bus ID: bus-b')).not.toBeInTheDocument());
});

const kpiFleet = [{ id: 'registered-bus', plateNumber: 'TEST 001', status: 'active', isPlaceholder: false }];
function kpiAlerts(warnings, criticals) {
  return [...Array(warnings).fill('Warning'), ...Array(criticals).fill('Critical')].map((severity, index) => ({
    id: `issue-${index}`, busId: 'registered-bus', busNumber: 'registered-bus', issueKey: `sensor-${index}`, title: `Sensor ${index}`, category: 'Vehicle Condition', severity, workflowStatus: 'New', timestampMs: 100 + index,
  }));
}

test.each([[5, 1, 6], [2, 0, 2], [0, 1, 1], [0, 0, 0]])('KPI derives %i warnings + %i critical as %i vehicle issues', (warnings, criticals, total) => {
  const counts = deriveMonitoringState(kpiFleet, kpiAlerts(warnings, criticals));
  expect(counts).toMatchObject({ warningIssueCount: warnings, criticalIssueCount: criticals, vehicleIssueCount: total, activeBusCount: 1, activeRouteDeviationCount: 0 });
  render(<SummaryCards counts={counts} busesLoading={false} onNavigate={jest.fn()} />);
  expect(screen.getAllByRole('button')).toHaveLength(3);
  expect(screen.queryByText('Trips in Progress')).not.toBeInTheDocument();
  expect(screen.getByText(total === 1 ? 'Vehicle Issue' : 'Vehicle Issues')).toBeInTheDocument();
  expect(Boolean(screen.queryByText(`${criticals} critical`))).toBe(criticals > 0);
  expect(Boolean(screen.queryByText(`${warnings} warnings`))).toBe(warnings > 0);
});

test('KPI deduplicates current sensors, preserves acknowledgement, excludes resolved and separates routes', () => {
  const repeated = { ...kpiAlerts(1, 0)[0], issueKey: 'fuel' };
  const alerts = [
    repeated,
    { ...repeated, id: 'new-sample', timestampMs: 200, severity: 'Critical', workflowStatus: 'Acknowledged' },
    { ...repeated, id: 'review', issueKey: 'air', workflowStatus: 'Under Review' },
    { ...repeated, id: 'resolved', issueKey: 'oil', workflowStatus: 'Resolved' },
    { ...repeated, id: 'dismissed', issueKey: 'battery', workflowStatus: 'Dismissed' },
    { ...repeated, id: 'route-old', category: 'Route' },
    { ...repeated, id: 'route-new', category: 'Route', timestampMs: 300 },
    { ...repeated, id: 'connectivity', category: 'Connectivity' },
    { ...repeated, id: 'deleted', busId: 'deleted-bus' },
  ];
  expect(deriveMonitoringState(kpiFleet, alerts)).toMatchObject({ warningIssueCount: 1, criticalIssueCount: 1, vehicleIssueCount: 2, activeRouteDeviationCount: 0 });
  // A newer resolution supersedes an older event for the same physical issue.
  expect(deriveMonitoringState(kpiFleet, [repeated, { ...repeated, id: 'resolved-latest', timestampMs: 500, workflowStatus: 'Resolved' }]).vehicleIssueCount).toBe(0);
  expect(deriveMonitoringState([...kpiFleet, { id: 'archived', status: 'active', isArchived: true }, { id: 'placeholder', status: 'active', isPlaceholder: true }, { id: 'inactive', status: 'inactive' }], []).activeBusCount).toBe(1);
});

test('latest normal sensor update clears the issue despite older warnings and stale overall status', () => {
  const base = { ...kpiFleet[0], overallGaugeStatus: 'Warning', gaugeReadings: [
    { id: 'old', gaugeKey: 'fuel', label: 'Fuel Level', status: 'Warning', analyzedAt: 100 },
    { id: 'repeat', gaugeKey: 'fuel', label: 'Fuel Level', status: 'Warning', analyzedAt: 200 },
  ] };
  const before = deriveMonitoringState(kpiFleet, buildApplicationAlerts([base]));
  expect(before.vehicleIssueCount).toBe(1);
  const critical = { ...base, gaugeReadings: [...base.gaugeReadings, { id: 'critical', gaugeKey: 'fuel', status: 'Critical', analyzedAt: 300 }] };
  expect(deriveMonitoringState(kpiFleet, buildApplicationAlerts([critical]))).toMatchObject({ warningIssueCount: 0, criticalIssueCount: 1 });
  const normal = { ...critical, gaugeReadings: [...critical.gaugeReadings, { id: 'normal', gaugeKey: 'fuel', status: 'Normal', analyzedAt: 400 }] };
  expect(deriveMonitoringState(kpiFleet, buildApplicationAlerts([normal])).vehicleIssueCount).toBe(0);
});

test('KPI hides counts while loading and opens matching active Alert Center filters', () => {
  const counts = deriveMonitoringState(kpiFleet, kpiAlerts(5, 1));
  const onNavigate = jest.fn();
  const { rerender } = render(<SummaryCards counts={counts} busesLoading onNavigate={onNavigate} />);
  expect(screen.getAllByText('—')).toHaveLength(3);
  expect(screen.queryByText('5 warnings')).not.toBeInTheDocument();
  rerender(<SummaryCards counts={counts} busesLoading={false} onNavigate={onNavigate} />);
  fireEvent.click(screen.getByRole('button', { name: /Vehicle Issues/ }));
  expect(onNavigate).toHaveBeenCalledWith({ page: 'alerts', category: 'Vehicle Condition', status: 'active' });
});

test('Alert Center active condition filters reconcile with KPI and survive live updates', () => {
  const incoming = [...kpiAlerts(5, 1), { ...kpiAlerts(1, 0)[0], id: 'resolved', issueKey: 'old', workflowStatus: 'Resolved' }, { ...kpiAlerts(1, 0)[0], id: 'route', category: 'Route' }];
  const counts = deriveMonitoringState(kpiFleet, incoming);
  const { rerender } = render(<AlertsPage alerts={counts.alerts} buses={kpiFleet} onUpdateAlert={jest.fn()} initialCategory="Vehicle Condition" initialStatus="active" />);
  expect(screen.getAllByRole('row')).toHaveLength(counts.vehicleIssueCount + 1);
  fireEvent.change(screen.getByLabelText('Filter alerts by severity'), { target: { value: 'Critical' } });
  fireEvent.change(screen.getByLabelText('Filter alerts by status'), { target: { value: 'New' } });
  expect(screen.getAllByRole('row')).toHaveLength(2);
  rerender(<AlertsPage alerts={[...counts.alerts]} buses={kpiFleet} onUpdateAlert={jest.fn()} initialCategory="Vehicle Condition" initialStatus="active" />);
  expect(screen.getByLabelText('Filter alerts by severity')).toHaveValue('Critical');
  expect(screen.getByLabelText('Filter alerts by status')).toHaveValue('New');
  expect(screen.getAllByRole('row')).toHaveLength(2);
});

test('missing condition telemetry cannot create fleet warnings, critical issues, or Alert Center rows', () => {
  const buses = normalizeOperationalBuses(kpiFleet);
  const counts = deriveMonitoringState(buses, buildApplicationAlerts(buses));
  expect(counts).toMatchObject({ warningIssueCount: 0, criticalIssueCount: 0, vehicleIssueCount: 0, activeRouteDeviationCount: 0 });
  expect(counts.activeAlerts.filter((alert) => alert.category === 'Vehicle Condition')).toEqual([]);
});

test('graphical Device Setup preserves existing Settings profile, logout, preferences and bus controls', async () => {
  const previous = window.localStorage.getItem('centrabus.notificationPreferences');
  window.localStorage.removeItem('centrabus.notificationPreferences');
  const onLogout = jest.fn();
  const view = render(<SettingsPage user={{ id: 'test-admin-only', email: 'admin@example.test' }} onLogout={onLogout} buses={[]} busesStatus="ready" />);
  try {
    expect(screen.getByRole('heading', { name: 'Administrator Profile' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alert Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wi-Fi Management' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Device Setup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configure Pi1 GPS-001' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configure Pi2 GPS-002' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bus Registration' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bus Management' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Sound notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
    await screen.findByText('Notification preferences saved on this browser.');
    expect(JSON.parse(window.localStorage.getItem('centrabus.notificationPreferences')).sound).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    if (previous === null) window.localStorage.removeItem('centrabus.notificationPreferences');
    else window.localStorage.setItem('centrabus.notificationPreferences', previous);
  }
});
