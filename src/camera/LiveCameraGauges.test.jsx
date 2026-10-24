import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LiveCameraView from './LiveCameraView';
import { AnimatedCameraGauge } from './LiveCameraGauges';
import { cameraSnapshot, TEST_CALIBRATION, TEST_TIME } from './testing/fixtures';
import { LIVE_GAUGE_PLACEHOLDERS } from './liveCameraGaugeModel';
import {cameraDialStatus} from './liveCameraGaugeModel';

const now = () => TEST_TIME;
const buses = [{ id: 'test-bus', plateNumber: 'SYNTHETIC ONE', gps: { deviceId: 'GPS-001' } },
  { id: 'test-bus-two', plateNumber: 'SYNTHETIC TWO', gps: { deviceId: 'GPS-002' } }];
const calibration = { ...TEST_CALIBRATION, gauges: Object.fromEntries(LIVE_GAUGE_PLACEHOLDERS.map(({ gaugeKey }) => [gaugeKey,
  { unit: 'fixture-unit', min: 0, max: 100, minConfidence: .8, displayScale: { approved: true, min: 0, max: 100 } }])) };
const panel = () => screen.getByRole('region', { name: 'Pi1 vehicle condition' });
const renderPage = (props = {}) => render(<LiveCameraView authorized gaugesEnabled buses={buses} calibration={calibration} clock={now} {...props} />);

test('display dial labels describe only fresh detected data and never call 32 percent half',()=>{
  const gauge={unverified:true,quality:'detected',status:'Reading Available',numericValue:50,dialPositionPercent:50};
  for(const [key,labels] of Object.entries({fuel:['Empty mark (E)','Halfway (E–F)','Full mark (F)'],coolant:['Cold','Mid-range','Hot'],battery:['Low','Mid-range','High'],oilPressure:['Low','Mid-range','High']})){
    for(const [index,percent] of [0,50,100].entries())expect(cameraDialStatus({...gauge,gaugeKey:key,dialPositionPercent:percent})).toBe(labels[index]);
  }
  expect(cameraDialStatus({...gauge,gaugeKey:'fuel',numericValue:31.911,dialPositionPercent:31.911})).toBe('Below half (E–F)');
  expect(cameraDialStatus({...gauge,gaugeKey:'frontAir'})).toBe('Pressure reading');
  for(const changed of [{status:'Stale'},{quality:'uncertain'},{numericValue:null},{dialPositionPercent:101}])
    expect(cameraDialStatus({...gauge,gaugeKey:'fuel',...changed})).toBeNull();
});

test('fuel labels follow the complete E-F angle mapping, not 25/75 buckets',()=>{
  const gauge={gaugeKey:'fuel',unverified:true,quality:'detected',status:'Reading Available',numericValue:50};
  for(const percent of [0.001,1,24.999,25,31.911,49.999])
    expect(cameraDialStatus({...gauge,dialPositionPercent:percent})).toBe('Below half (E–F)');
  for(const percent of [50.001,74.999,75,99,99.999])
    expect(cameraDialStatus({...gauge,dialPositionPercent:percent})).toBe('Above half (E–F)');
  for(const changed of [{dialPositionPercent:-1},{dialPositionPercent:NaN},{dialPositionPercent:50,status:'Stale'},
    {dialPositionPercent:50,quality:'uncertain'},{dialPositionPercent:50,numericValue:null}])
    expect(cameraDialStatus({...gauge,...changed})).toBeNull();
});

test('camera estimate wording keeps E-F endpoints and the source needle angle without certifying calibration',()=>{
  render(<AnimatedCameraGauge gauge={{gaugeKey:'fuel',unverified:true,quality:'detected',status:'Reading Available',
    numericValue:31.911,dialPositionPercent:31.911,angleDegrees:115.02,capturedAt:new Date(TEST_TIME-1000).toISOString(),ageMs:1000}}/>);
  expect(screen.getByText('Below half (E–F) · dial estimate')).toHaveAttribute('title',expect.stringContaining('115.020°'));
  expect(screen.getByText('Detected · camera estimate')).toBeInTheDocument();
  expect(screen.getByText('Angle: 115.02°')).toBeInTheDocument();
  expect(screen.getByTestId('fuel-needle')).toHaveStyle('transform: rotate(-25.019999999999996deg)');
  expect(screen.getByText('E')).toBeInTheDocument();expect(screen.getByText('F')).toBeInTheDocument();
  expect(screen.queryByText('Half')).not.toBeInTheDocument();
  expect(screen.queryByText('Validated reading')).not.toBeInTheDocument();
});

test('six gauges remain visible with production integration disabled and no reads', () => {
  const service = { readLatest: jest.fn() };
  renderPage({ gaugesEnabled: false, gaugeService: service });
  expect(screen.getAllByText('Awaiting data')).toHaveLength(6);
  expect(service.readLatest).not.toHaveBeenCalled();
  expect(within(panel()).getByText('Readings not connected')).toBeInTheDocument();
});

test('missing or ambiguous device assignment blocks every read', () => {
  const service = { readLatest: jest.fn() };
  const view = renderPage({ buses: [], gaugeService: service });
  expect(service.readLatest).not.toHaveBeenCalled();
  view.rerender(<LiveCameraView authorized gaugesEnabled buses={[buses[0], { ...buses[0], id: 'ambiguous' }]}
    calibration={calibration} gaugeService={service} clock={now} />);
  expect(screen.getByText(/association is ambiguous/)).toBeInTheDocument();
  expect(service.readLatest).not.toHaveBeenCalled();
});

test('validated numbers use the original capture and approved scale; no Normal status or alerts are invented', async () => {
  renderPage({ gaugeService: { readLatest: async () => cameraSnapshot() } });
  await within(panel()).findByText('42');
  expect(screen.getByTestId('fuel-needle')).toHaveStyle('transform: rotate(-8.799999999999997deg)');
  expect(within(panel()).getAllByText('Awaiting data')).toHaveLength(5);
  expect(within(panel()).getByText('Confidence 95%')).toBeInTheDocument();
  expect(panel().querySelector('time')).toHaveAttribute('datetime', new Date(TEST_TIME - 1000).toISOString());
  expect(screen.queryByText('Normal')).not.toBeInTheDocument();
});

test('numeric values without an approved display scale do not move a needle', () => {
  render(<AnimatedCameraGauge gauge={{ gaugeKey: 'fuel', numericValue: 42, unit: 'fixture-unit', status: 'Reading Available' }} calibration={TEST_CALIBRATION} />);
  expect(screen.getByText('42')).toBeInTheDocument();
  expect(screen.getByText('SCALE PENDING')).toBeInTheDocument();
  expect(screen.queryByTestId('fuel-needle')).not.toBeInTheDocument();
});

test('switching devices clears old gauges immediately and requests only the explicitly mapped second bus', async () => {
  let signal;
  const service = { readLatest: jest.fn((id, options) => {
    signal = options.signal;
    return id === 'test-bus' ? Promise.resolve(cameraSnapshot()) : new Promise(() => {});
  }) };
  const view = renderPage({ gaugeService: service });
  await within(panel()).findByText('42');
  fireEvent.click(screen.getByRole('tab', { name: /Pi2/ }));
  expect(screen.queryByText('42')).not.toBeInTheDocument();
  await waitFor(() => expect(service.readLatest).toHaveBeenLastCalledWith('test-bus-two', expect.objectContaining({ signal: expect.anything() })));
  expect(screen.getByRole('region', { name: 'Pi2 vehicle condition' })).toHaveTextContent('SYNTHETIC TWO');
  view.unmount(); expect(signal.aborted).toBe(true);
});

function media(cameraId = 'TEST-CAM-1') {
  const track = new EventTarget(); Object.assign(track, { kind: 'video', readyState: 'live', stop: jest.fn() });
  return { deviceId: 'GPS-001', cameraId, close: jest.fn(), track,
    stream: { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] } };
}

test('automatic video does not reset or stop gauge updates after a stream ends', async () => {
  const stream = media(); const videoService = { isConfigured: () => true, open: jest.fn(async () => stream) };
  const readings = { readLatest: jest.fn(async () => cameraSnapshot()) };
  renderPage({ service: videoService, gaugeService: readings });
  await within(panel()).findByText('42');
  await screen.findByText('Waiting for video');
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  act(() => stream.track.dispatchEvent(new Event('ended')));
  expect(stream.close).toHaveBeenCalledTimes(1); expect(stream.track.stop).toHaveBeenCalledTimes(1);
  expect(within(panel()).getByText('42')).toBeInTheDocument();
  expect(readings.readLatest).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh gauge readings' }));
  await waitFor(() => expect(readings.readLatest).toHaveBeenCalledTimes(2));
  expect(videoService.open).toHaveBeenCalledTimes(1);
});

test('preview and numerical camera identity mismatch withholds values', async () => {
  let finish;
  renderPage({ service: { isConfigured: () => true, open: () => new Promise(resolve => { finish = resolve; }) },
    gaugeService: { readLatest: async () => cameraSnapshot() } });
  await within(panel()).findByText('42');
  await act(async () => finish(media('OTHER-CAMERA')));
  await screen.findByText(/preview and gauge readings identify different cameras/);
  expect(within(panel()).queryByText('42')).not.toBeInTheDocument();
  expect(screen.queryByTestId('fuel-needle')).not.toBeInTheDocument();
});

test('stale observations remain last-known with their original capture time and frozen-needle styling', async () => {
  renderPage({ gaugeService: { readLatest: async () => cameraSnapshot({ captured_at: new Date(TEST_TIME - 60000).toISOString() }) } });
  await within(panel()).findByText('42');
  expect(within(panel()).getByText('Last known · stale')).toBeInTheDocument();
  expect(screen.getByTestId('fuel-needle')).toHaveClass('is-stale');
  expect(panel().querySelector('time')).toHaveAttribute('datetime', new Date(TEST_TIME - 60000).toISOString());
});

test('bounded numerical polling continues with preview off and preserves the needle while refreshing', async () => {
  jest.useFakeTimers();
  try {
    let finish;
    const readings = { readLatest: jest.fn().mockResolvedValueOnce(cameraSnapshot())
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })) };
    const view = renderPage({ gaugeService: readings });
    await act(async () => {});
    const needle = screen.getByTestId('fuel-needle');
    await act(async () => jest.advanceTimersByTime(10001));
    expect(readings.readLatest).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('fuel-needle')).toBe(needle);
    await act(async () => finish(cameraSnapshot({ numeric_value: '60' })));
    expect(within(panel()).getByText('60')).toBeInTheDocument();
    expect(screen.getByTestId('fuel-needle')).toBe(needle);
    expect(needle).toHaveStyle('transform: rotate(11deg)');
    view.unmount();
  } finally { jest.useRealTimers(); }
});

test('physical panel order and bus-style arcs are present even before detection', () => {
  const ui = renderPage({ gaugesEnabled: false });
  expect([...ui.container.querySelectorAll('[data-gauge-key]')].map(node => node.dataset.gaugeKey))
    .toEqual(['fuel', 'coolant', 'frontAir', 'rearAir', 'battery', 'oilPressure']);
  expect(screen.getAllByText('Angle: —')).toHaveLength(6);
  expect([...ui.container.querySelectorAll('.camera-condition-dial')].every(svg => svg.dataset.sweepDegrees === '110')).toBe(true);
  for (const key of ['frontAir', 'rearAir']) {
    const card = ui.container.querySelector(`[data-gauge-key="${key}"]`);
    expect([...card.querySelectorAll('.camera-dial-scale')].map(node => node.textContent)).toEqual(['0', '5', '10', '15']);
  }
});

test.each(['uncertain', 'undetected', 'stale', 'missing-angle'])('source angle stays blank for %s observations', (kind) => {
  const gauge = { gaugeKey:'fuel', unverified:true, quality:'detected', status:'Reading Available',
    numericValue:31.911, dialPositionPercent:31.911, angleDegrees:115.02 };
  if (kind === 'stale') gauge.status = 'Stale';
  else if (kind === 'missing-angle') gauge.angleDegrees = null;
  else Object.assign(gauge, { quality:kind, numericValue:null, dialPositionPercent:null });
  render(<AnimatedCameraGauge gauge={gauge}/>);
  expect(screen.getByText('Angle: —')).toBeInTheDocument();
  expect(screen.queryByText('Angle: 115.02°')).not.toBeInTheDocument();
  if (['uncertain', 'undetected'].includes(kind)) expect(screen.queryByTestId('fuel-needle')).not.toBeInTheDocument();
});
