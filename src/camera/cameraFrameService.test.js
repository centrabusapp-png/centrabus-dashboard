import { cameraFrameReply, createCameraFrameService, frameGauges, FRAME_GAUGE_KEYS } from './cameraFrameService';
const NOW = Date.parse('2026-10-20T04:00:00.000Z');
export function fixture(device = 'GPS-001', sequence = 1) {
  return { ok: true, deviceId: device, state: 'live', frame: { protocol_version: 1, device_id: device, camera_id: `cam-${device}`, bus_id: `bus-${device}`,
    session_id: 'test-session', sequence, capture_id: `test-session:${sequence}`, captured_at: new Date(NOW-1000).toISOString(), received_at: new Date(NOW).toISOString(),
    timestamp_source: 'SensorTimestamp/CLOCK_BOOTTIME', processor_version: 'test-v1', interpretation: 'unverified', calibration_verified: false,
    readings: FRAME_GAUGE_KEYS.map((gauge_key) => ({ gauge_key, quality: 'detected', value: 35, angle_deg: 90, dial_percent: 35, unit: ['frontAir','rearAir'].includes(gauge_key) ? 'kg/cm2' : '%' })),
    image: { mime_type: 'image/jpeg', sha256: 'a'.repeat(64), base64: 'AAAA' } } };
}
test('single capture contains six keyed observations; missing/uncertain data is not a previous or zero value', () => {
  const body = fixture(); body.frame.readings[1] = { ...body.frame.readings[1], quality: 'uncertain', value: null, angle_deg: null, dial_percent: null };
  const result = cameraFrameReply(body, 'GPS-001'); const gauges = frameGauges(result.frame, NOW);
  expect(gauges).toHaveLength(6); expect(gauges[1].numericValue).toBeNull(); expect(gauges[1].quality).toBe('uncertain');
  expect(new Set(gauges.map((g) => g.captureId)).size).toBe(1);
  expect(new Set(gauges.map((g) => g.capturedAt)).size).toBe(1);
  expect(gauges.every((g) => g.confidence === null && g.unverified)).toBe(true);
});

test('physical panel order is independent of incoming array order and preserves each source angle/value', () => {
  const body = fixture();
  body.frame.readings.forEach((row, i) => { row.value = i + 10; row.angle_deg = 141.234 - i; });
  body.frame.readings.reverse();
  const {frame} = cameraFrameReply(body, 'GPS-001');
  const gauges = frameGauges(frame, NOW);
  expect(gauges.map(g => g.gaugeKey)).toEqual(['fuel', 'coolant', 'frontAir', 'rearAir', 'battery', 'oilPressure']);
  for (const gauge of gauges) {
    const source = body.frame.readings.find(row => row.gauge_key === gauge.gaugeKey);
    expect(gauge.numericValue).toBe(source.value);
    expect(gauge.angleDegrees).toBe(source.angle_deg);
    expect(gauge.captureId).toBe(body.frame.capture_id);
  }
});
test.each(['device', 'camera', 'duplicate', 'missing', 'normal', 'calibrated', 'timestamp', 'units', 'invalid-image'])('%s malformed frame is rejected', (kind) => {
  const b = fixture();
  if (kind === 'device') b.frame.device_id = 'GPS-002';
  if (kind === 'camera') b.frame.camera_id = '../camera';
  if (kind === 'duplicate') b.frame.readings[1] = b.frame.readings[0];
  if (kind === 'missing') b.frame.readings.pop();
  if (kind === 'normal') b.frame.interpretation = 'normal';
  if (kind === 'calibrated') b.frame.calibration_verified = true;
  if (kind === 'timestamp') b.frame.captured_at = 'not-utc';
  if (kind === 'units') b.frame.readings[0].unit = 'volts';
  if (kind === 'invalid-image') b.frame.image.base64 = 'http://untrusted/image';
  expect(() => cameraFrameReply(b, 'GPS-001')).toThrow();
});
test('source ages and last-known state do not appear newly verified', () => {
  const f = fixture().frame;
  expect(frameGauges(f, NOW+20000).every((g) => g.status === 'Stale')).toBe(true);
  expect(frameGauges(f, NOW, 'last-known').every((g) => g.status === 'Stale')).toBe(true);
});

test('an empty or switched-off view is awaiting data, not a fabricated last-known stale reading', () => {
  const gauges = frameGauges(null, NOW, 'waiting');
  expect(gauges.every(g => g.status === 'Awaiting Data' && g.numericValue === null && g.angleDegrees === null)).toBe(true);
});
test('API uses authenticated loopback proxy, bounded response and no device secret', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(fixture()) }));
  const service = createCameraFrameService({ enabled: true, config: { configured: true }, getSession: async () => ({ data: { session: { access_token: 'synthetic-admin' } } }), fetchImpl });
  await service.read('GPS-001', { preview: true });
  expect(fetchImpl).toHaveBeenCalledWith('/api/camera-frames/devices/GPS-001/latest?preview=1', expect.objectContaining({ redirect: 'error', cache: 'no-store', credentials: 'omit' }));
  expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('credential_hash');
  expect(createCameraFrameService({ enabled: false }).enabled).toBe(false);
});

test('fast live endpoint cannot substitute detected readings for the independent analysis',async()=>{
  let body=fixture();body.frame.readings.forEach(r=>Object.assign(r,{quality:'undetected',value:null,angle_deg:null,dial_percent:null}));
  const fetchImpl=jest.fn(async()=>({ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify(body)}));
  const service=createCameraFrameService({enabled:true,config:{configured:true},getSession:async()=>({data:{session:{access_token:'synthetic'}}}),fetchImpl});
  expect(service.fastPreview).toBe(true);
  await expect(service.readLive('GPS-001',{preview:true})).resolves.toHaveProperty('state','live');
  expect(fetchImpl.mock.calls[0][0]).toBe('/api/camera-frames/devices/GPS-001/live?preview=1');
  body=fixture();await expect(service.readLive('GPS-001',{preview:true})).rejects.toThrow('live-cannot-assert-gauges');
});
test('absent admin, HTTP error, cancellation and oversized reply cannot yield readings', async () => {
  for (const response of [{ ok: false }, { ok: true, headers: { get: () => 'text/html' } }, { ok: true, headers: { get: () => 'application/json' }, text: async () => 'x'.repeat(2850001) }]) {
    const s = createCameraFrameService({ enabled: true, config: { configured: true }, getSession: async () => ({ data: { session: { access_token: 'synthetic' } } }), fetchImpl: async () => response });
    await expect(s.read('GPS-001')).rejects.toThrow();
  }
});

test('a stalled live request has a shorter deadline than analysis and aborts the request',async()=>{
  jest.useFakeTimers();
  try{
    let signal;
    const service=createCameraFrameService({enabled:true,config:{configured:true},
      getSession:async()=>({data:{session:{access_token:'synthetic'}}}),
      fetchImpl:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
    const result=service.readLive('GPS-001',{preview:true});
    const rejected=expect(result).rejects.toThrow('camera-temporary-unavailable');
    await Promise.resolve();await Promise.resolve();
    jest.advanceTimersByTime(1500);
    await rejected;
    expect(signal.aborted).toBe(true);
  }finally{jest.useRealTimers();}
});

test('local save is click-invoked only, authenticated, bounded to the fixed path and requires a save receipt',async()=>{
  const filename='centrabus-GPS-001-2026-10-20T04-00-00-000Z-12345678.png';
  const fetchImpl=jest.fn(async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({ok:true,saved:true,filename,relativePath:`captured-images/${filename}`})}));
  const service=createCameraFrameService({enabled:true,config:{configured:true},
    getSession:async()=>({data:{session:{access_token:'synthetic'}}}),fetchImpl});
  expect(fetchImpl).not.toHaveBeenCalled();
  const frame=fixture().frame,blob=new Blob(['png'],{type:'image/png'});
  await expect(service.saveCapture(frame,{blob})).resolves.toHaveProperty('saved',true);
  expect(fetchImpl).toHaveBeenCalledWith('/api/local-camera-captures/GPS-001',expect.objectContaining({method:'POST',body:blob,
    headers:expect.objectContaining({'X-CentraBus-Capture':'manual-v1','X-Camera-Capture-Id':frame.capture_id})}));
  fetchImpl.mockResolvedValue({ok:false});
  await expect(service.saveCapture(frame,{blob})).rejects.toThrow('capture-not-saved');
  for(const status of [400,403,429,503]){
    fetchImpl.mockResolvedValue({ok:false,status});
    await expect(service.saveCapture(frame,{blob})).rejects.toThrow(`capture-save-http-${status}`);
  }
});
test('bus association comes from authenticated camera snapshots, not GPS age/order; duplicate assignments are rejected', async () => {
  const fetchImpl=jest.fn(async(url)=>({ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify(fixture(url.includes('GPS-002')?'GPS-002':'GPS-001'))}));
  const service=createCameraFrameService({enabled:true,config:{configured:true},getSession:async()=>({data:{session:{access_token:'synthetic'}}}),fetchImpl});
  const result=await service.readForBus('bus-GPS-002');expect(result.frame.device_id).toBe('GPS-002');
  expect(fetchImpl.mock.calls.every(([url])=>url.endsWith('preview=0'))).toBe(true);
  fetchImpl.mockImplementation(async(url)=>{const body=fixture(url.includes('GPS-002')?'GPS-002':'GPS-001');body.frame.bus_id='same-bus';return {ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify(body)};});
  await expect(service.readForBus('same-bus')).rejects.toThrow('ambiguous-camera-bus');
});
