import { LIVE_GAUGE_KEYS } from './liveCameraGaugeModel.js';

export const FRAME_GAUGE_KEYS = LIVE_GAUGE_KEYS;
const id = (s) => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(s);
const utc = (s) => typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
const boundedNumber = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
export function cameraFrameReply(body, deviceId) {
  if (body?.ok !== true || body.deviceId !== deviceId || !['live', 'last-known', 'waiting', 'not-enrolled'].includes(body.state)) throw new Error('invalid-camera-response');
  if (body.frame === null && ['waiting', 'not-enrolled'].includes(body.state)) return { state: body.state, frame: null };
  const f = body.frame;
  if (!f || f.protocol_version !== 1 || f.device_id !== deviceId || !id(f.camera_id) || typeof f.bus_id !== 'string' || !f.bus_id || f.bus_id.length > 128
    || !id(f.session_id) || !Number.isSafeInteger(f.sequence) || f.sequence < 1 || f.capture_id !== `${f.session_id}:${f.sequence}` || !id(f.capture_id)
    || !utc(f.captured_at) || !utc(f.received_at) || Date.parse(f.captured_at) > Date.parse(f.received_at) + 2000
    || f.timestamp_source !== 'SensorTimestamp/CLOCK_BOOTTIME' || !id(f.processor_version)
    || f.calibration_verified !== false || f.interpretation !== 'unverified'
    || !Array.isArray(f.readings) || f.readings.length !== 6 || !f.image || f.image.mime_type !== 'image/jpeg' || !/^[a-f0-9]{64}$/.test(f.image.sha256)) throw new Error('invalid-camera-frame');
  const seen = new Set();
  const readings = f.readings.map((r) => {
    const pressure = ['frontAir', 'rearAir'].includes(r.gauge_key);
    if (!FRAME_GAUGE_KEYS.includes(r.gauge_key) || seen.has(r.gauge_key) || !['detected', 'uncertain', 'undetected'].includes(r.quality)
      || r.unit !== (pressure ? 'kg/cm2' : '%') || r.value !== null && !boundedNumber(r.value, 0, pressure ? 1000 : 100)
      || r.angle_deg !== null && !boundedNumber(r.angle_deg, -360, 360) || r.dial_percent !== null && !boundedNumber(r.dial_percent, 0, 100)
      || r.quality !== 'detected' && [r.value, r.angle_deg, r.dial_percent].some((v) => v !== null)
      || r.quality === 'detected' && r.angle_deg === null || r.value === null && r.dial_percent !== null) throw new Error('invalid-camera-reading');
    seen.add(r.gauge_key);
    return { gauge_key: r.gauge_key, quality: r.quality, value: r.value, unit: r.unit, angle_deg: r.angle_deg, dial_percent: r.dial_percent };
  });
  let image = { mime_type: 'image/jpeg', sha256: f.image.sha256 };
  if (f.image.base64 !== undefined) {
    if (body.state !== 'live' || typeof f.image.base64 !== 'string' || !f.image.base64.length || f.image.base64.length > 2796204
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.image.base64)) throw new Error('invalid-camera-image');
    image.base64 = f.image.base64;
  }
  return { state: body.state, frame: { protocol_version: 1, device_id: deviceId, camera_id: f.camera_id, bus_id: f.bus_id,
    session_id: f.session_id, sequence: f.sequence, capture_id: f.capture_id, captured_at: f.captured_at, received_at: f.received_at,
    timestamp_source: f.timestamp_source, processor_version: f.processor_version, calibration_verified: false,
    interpretation: 'unverified', readings, image } };
}
export function frameGauges(frame, now = Date.now(), state = 'live') {
  return FRAME_GAUGE_KEYS.map((key) => {
    const r = frame?.readings.find((row) => row.gauge_key === key);
    const ageMs = frame ? now - Date.parse(frame.captured_at) : null;
    const stale = Boolean(frame && (state !== 'live' || ageMs < -2000 || ageMs > 15000));
    return { id: `${frame?.capture_id || 'missing'}:${key}`, gaugeKey: key, cameraId: frame?.camera_id,
      captureId: frame?.capture_id, numericValue: r?.value ?? null, unit: r?.unit, confidence: null,
      quality: r?.quality || 'undetected', capturedAt: frame?.captured_at, ageMs: Math.max(0, ageMs || 0),
      angleDegrees: r?.angle_deg ?? null,
      status: stale ? 'Stale' : r?.quality === 'detected' ? 'Reading Available' : 'Awaiting Data',
      unverified: true, dialPositionPercent: r?.dial_percent ?? null };
  });
}
export function createCameraFrameService({ development = process.env.NODE_ENV !== 'production', config, enabled = false, previewOnly = false, getSession, fetchImpl = (...args) => fetch(...args) } = {}) {
  if (!enabled || config?.configured !== true) return Object.freeze({ enabled: false });
  if (!development && (config.cloudCameraEnabled !== true || !config.origin?.startsWith('https://'))) return Object.freeze({ enabled: false });
  const endpoint = development ? '' : config.origin;
  const service = { enabled: true, fastPreview: true, previewOnly: previewOnly === true, async read(deviceId, { signal, preview = false, live = false } = {}) {
    if (!['GPS-001', 'GPS-002'].includes(deviceId)) throw new Error('invalid-camera-device');
    const controller = new AbortController();
    let rejectDeadline;
    const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
    const abort = () => { controller.abort(); rejectDeadline(new Error('camera-request-unavailable')); };
    const timer = setTimeout(() => {
      controller.abort();rejectDeadline(new Error(live ? 'camera-temporary-unavailable' : 'camera-request-unavailable'));
    }, live ? 1500 : 6000);
    signal?.addEventListener('abort', abort, { once: true });
    const perform = async () => {
      const session = await getSession();
      const token = session?.data?.session?.access_token;
      if (session?.error || !token || signal?.aborted || controller.signal.aborted) throw new Error('camera-authentication-required');
      // Development uses the loopback proxy; approved production uses the configured HTTPS backend.
      let response;
      try {
        response = await fetchImpl(`${endpoint}/api/camera-frames/devices/${deviceId}/${live ? 'live' : 'latest'}?preview=${preview ? '1' : '0'}`, {
          cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        });
      } catch (error) {
        // A fetch transport failure is a brief reconnect, not an authority
        // rejection. Parsing/identity/auth errors below still clear the frame.
        if (live && error?.name === 'TypeError' && !signal?.aborted && !controller.signal.aborted) {
          throw new Error('camera-temporary-unavailable');
        }
        throw error;
      }
      // Authority lookup failures (503) must clear the old image immediately.
      if (!response.ok && live && [408,429,500,502,504].includes(response.status)) throw new Error('camera-temporary-unavailable');
      if (!response.ok || !response.headers?.get('content-type')?.includes('application/json')) throw new Error('camera-not-ready');
      let text = ''; let size = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader(); const decoder = new TextDecoder();
        try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
          if (size > 2850000) throw new Error('camera-response-too-large'); text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); }
        finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } else { text = await response.text(); if (text.length > 2850000) throw new Error('camera-response-too-large'); }
      if (signal?.aborted || controller.signal.aborted) throw new Error('camera-request-cancelled');
      return cameraFrameReply(JSON.parse(text), deviceId);
    };
    try { return await Promise.race([perform(), deadline]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  } };
  service.readLive = async (deviceId, options = {}) => {
    const reply = await service.read(deviceId, { ...options, live: true });
    if (reply.frame?.readings.some(r => r.quality !== 'undetected')) throw Error('live-cannot-assert-gauges');
    return reply;
  };
  // Only the explicit Capture callback calls this method. No preview polling
  // invokes the local disk writer, and the browser cannot choose a file path.
  if (development) service.saveCapture = async (frame, {blob}, {signal} = {}) => {
    if (!['GPS-001','GPS-002'].includes(frame?.device_id) || !id(frame.capture_id)
      || !blob || blob.type !== 'image/png' || !blob.size || blob.size > 20*1024*1024) throw Error('invalid-capture');
    const controller=new AbortController();
    const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(cancel,12000);
    try{
      const session=await getSession();const token=session?.data?.session?.access_token;
      if(session?.error||!token||signal?.aborted)throw Error('capture-auth-required');
      const response=await fetchImpl(`/api/local-camera-captures/${frame.device_id}`,{
        method:'POST',cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,
        headers:{'Content-Type':'image/png',Authorization:`Bearer ${token}`,
          'X-CentraBus-Capture':'manual-v1','X-Camera-Capture-Id':frame.capture_id},body:blob});
      if(!response.ok)throw Error([400,403,429,503].includes(response.status)?`capture-save-http-${response.status}`:'capture-not-saved');
      if(!response.headers?.get('content-type')?.includes('application/json'))throw Error('capture-not-saved');
      const result=await response.json();
      if(result.ok!==true||result.saved!==true||typeof result.filename!=='string'
        ||!/^centrabus-GPS-00[12]-[A-Za-z0-9-]+\.png$/.test(result.filename)
        ||result.relativePath!==`captured-images/${result.filename}`)throw Error('invalid-capture-receipt');
      return result;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  };
  service.readForBus = async (busId, { signal } = {}) => {
    if (typeof busId !== 'string' || !busId || busId.length > 128) throw new Error('invalid-camera-bus');
    const reports = await Promise.all(['GPS-001','GPS-002'].map((device) => service.read(device, { signal, preview: false })));
    const matches = reports.filter((report) => report.frame?.bus_id === busId);
    if (matches.length > 1) throw new Error('ambiguous-camera-bus');
    return matches[0] || { state: 'waiting', frame: null };
  };
  return Object.freeze(service);
}
