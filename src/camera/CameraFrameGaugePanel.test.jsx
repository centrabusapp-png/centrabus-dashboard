import { act, render, screen, waitFor } from '@testing-library/react';
import CameraFrameGaugePanel from './CameraFrameGaugePanel';
import { FRAME_GAUGE_KEYS } from './cameraFrameService';
const NOW=Date.parse('2026-10-20T04:00:00.000Z'); const clock=()=>NOW;
test('vehicle condition uses one camera snapshot without GPS freshness or fabricated Normal labels',async()=>{
  const frame={device_id:'GPS-002',camera_id:'test-cam',bus_id:'selected-bus',capture_id:'source:1',captured_at:new Date(NOW-1000).toISOString(),
    readings:FRAME_GAUGE_KEYS.map(gauge_key=>({gauge_key,value:42,quality:'detected',unit:'%',dial_percent:42}))};
  const service={readForBus:jest.fn(async()=>({state:'live',frame}))};
  render(<CameraFrameGaugePanel busId="selected-bus" service={service} clock={clock}/>);
  await waitFor(()=>expect(screen.getAllByText('42')).toHaveLength(6));
  expect(service.readForBus).toHaveBeenCalledWith('selected-bus',expect.objectContaining({signal:expect.anything()}));
  expect(screen.getByLabelText('Same-capture gauge observations')).toHaveAttribute('data-capture-id','source:1');
  expect(screen.queryByText(/^Normal$/)).not.toBeInTheDocument();
});

const compactFrame = (age = 1000) => ({ device_id: 'GPS-002', camera_id: 'test-cam', bus_id: 'selected-bus',
  capture_id: 'source:2', captured_at: new Date(NOW - age).toISOString(),
  readings: FRAME_GAUGE_KEYS.map((gauge_key) => ({ gauge_key, value: gauge_key === 'rearAir' ? null : 42,
    quality: gauge_key === 'rearAir' ? 'uncertain' : 'detected', unit: ['frontAir', 'rearAir'].includes(gauge_key) ? 'kg/cm2' : '%',
    angle_deg: gauge_key === 'rearAir' ? null : 101.25, dial_percent: gauge_key === 'rearAir' ? null : 42 })) });

test('compact view keeps six gauges in physical order with one freshness label and source angles', async () => {
  const frame = compactFrame();
  const { container } = render(<CameraFrameGaugePanel compact busId="selected-bus" clock={clock}
    service={{ readForBus: async () => ({ state: 'live', frame }) }} />);
  await screen.findByText('5 of 6 detected');
  expect(screen.getByRole('status')).toHaveTextContent('Fresh · 1s ago');
  expect(screen.getAllByText('Angle: 101.25°')).toHaveLength(5);
  expect(screen.getByText('Uncertain · no value')).toBeInTheDocument();
  expect(screen.queryByText(/Capture source:2/)).not.toBeInTheDocument();
  expect(container.querySelectorAll('.is-compact')).toHaveLength(6);
  expect([...container.querySelectorAll('[data-gauge-key]')].map((el) => el.dataset.gaugeKey)).toEqual(FRAME_GAUGE_KEYS);
  expect(screen.getByLabelText('Same-capture gauge observations')).toHaveAttribute('data-capture-id', 'source:2');
});

test.each(['last-known', 'live'])('compact view withholds stale values and angles for %s snapshots', async (state) => {
  const frame = compactFrame(13 * 3600000);
  render(<CameraFrameGaugePanel compact busId="selected-bus" clock={clock}
    service={{ readForBus: async () => ({ state, frame }) }} />);
  await screen.findByText('Readings out of date');
  expect(screen.getByRole('status')).toHaveTextContent('Stale · 13h ago');
  expect(screen.queryByText('42')).not.toBeInTheDocument();
  expect(screen.queryByText('Angle: 101.25°')).not.toBeInTheDocument();
  expect(screen.getAllByText('Angle: —')).toHaveLength(6);
});

test('compact freshness expires without a successful new source capture', async () => {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(NOW);
    const frame = compactFrame();
    render(<CameraFrameGaugePanel compact busId="selected-bus" clock={() => Date.now()}
      service={{ readForBus: async () => ({ state: 'live', frame }) }} />);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(screen.getByText('5 of 6 detected')).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(screen.getByText('Readings out of date')).toBeInTheDocument();
    expect(screen.queryByText('42')).not.toBeInTheDocument();
  } finally { jest.useRealTimers(); }
});

test('compact view clears mismatched-bus data and keeps unavailable gauges blank', async () => {
  const frame = { ...compactFrame(), bus_id: 'another-bus' };
  render(<CameraFrameGaugePanel compact busId="selected-bus" clock={clock}
    service={{ readForBus: async () => ({ state: 'live', frame }) }} />);
  await screen.findByText('Camera unavailable');
  expect(screen.queryByText('42')).not.toBeInTheDocument();
  expect(screen.queryByText(/^Normal$/)).not.toBeInTheDocument();
  expect(screen.getAllByText('Angle: —')).toHaveLength(6);
});
