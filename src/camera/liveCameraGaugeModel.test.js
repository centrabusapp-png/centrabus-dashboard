import { approvedDialPosition, cameraDeviceAssociation, LIVE_GAUGE_PLACEHOLDERS } from './liveCameraGaugeModel';

test('device association never guesses from bus order, plate or missing identity', () => {
  const buses = [{ id: 'bus-2', plateNumber: 'BUS TWO', gps: { deviceId: 'GPS-002' } },
    { id: 'bus-1', plateNumber: 'BUS ONE', gps: { deviceId: 'GPS-001' } }];
  expect(cameraDeviceAssociation(buses, 'GPS-001')).toMatchObject({ busId: 'bus-1', plate: 'BUS ONE' });
  expect(cameraDeviceAssociation([...buses].reverse(), 'GPS-002').busId).toBe('bus-2');
  expect(cameraDeviceAssociation([{ id: 'bus-1', deviceId: 'GPS-001' }], 'GPS-001').busId).toBeNull();
  expect(cameraDeviceAssociation([...buses, { id: 'duplicate', gps: { deviceId: 'GPS-001' } }], 'GPS-001').busId).toBeNull();
});

test('all six placeholders have independent keys and no fabricated values or units', () => {
  expect(LIVE_GAUGE_PLACEHOLDERS.map((g) => g.gaugeKey)).toEqual(['fuel', 'oilPressure', 'coolant', 'frontAir', 'battery', 'rearAir']);
  expect(LIVE_GAUGE_PLACEHOLDERS.every((g) => g.numericValue === undefined && g.unit === undefined)).toBe(true);
});

const gauge = { gaugeKey: 'fuel', numericValue: 42, unit: 'fixture-unit', status: 'Reading Available' };
const policy = { approved: true, gauges: { fuel: { min: 0, max: 100, unit: 'fixture-unit' } } };
test('validation bounds alone never become a fabricated physical gauge scale', () => {
  expect(approvedDialPosition(gauge, policy)).toBeNull();
  expect(approvedDialPosition(gauge, { ...policy, gauges: { fuel: { ...policy.gauges.fuel, displayScale: { approved: false, min: 0, max: 100 } } } })).toBeNull();
});
test('only explicitly approved display scales position the needle; stale values keep the same position', () => {
  const calibration = { ...policy, gauges: { fuel: { ...policy.gauges.fuel, displayScale: { approved: true, min: 0, max: 100 } } } };
  expect(approvedDialPosition(gauge, calibration)).toEqual({ percent: 42, min: 0, max: 100 });
  expect(approvedDialPosition({ ...gauge, status: 'Stale' }, calibration)?.percent).toBe(42);
  for (const change of [{ numericValue: Infinity }, { numericValue: -1 }, { numericValue: 101 }, { unit: 'invented' }, { status: 'Invalid' }]) {
    expect(approvedDialPosition({ ...gauge, ...change }, calibration)).toBeNull();
  }
  expect(approvedDialPosition(gauge, { ...calibration, approved: false })).toBeNull();
  for (const scale of [{ min: 1, max: 1 }, { min: -1, max: 100 }, { min: 0, max: 101 }]) {
    expect(approvedDialPosition(gauge, { ...policy, gauges: { fuel: { ...policy.gauges.fuel, displayScale: { approved: true, ...scale } } } })).toBeNull();
  }
});
