import { LIVE_CAMERA_DEVICES, validLiveCameraSession } from './liveCameraService';
import { decodeGaugeDials, drawGaugeEvidence, gaugePanelMatchesDevice, snapshotGaugePanel } from './cameraGaugeEvidence';

export const EVIDENCE_ACTIVITY_LIMIT_MS = 3000;

// Playback activity is not the original camera capture time. Refuse unavailable
// or delayed playback, but never claim that advancing video proves source age.
export function canCaptureCameraEvidence({ video, session, deviceId, status, lastActivity, now, gaugePanel }) {
  try {
    return LIVE_CAMERA_DEVICES.some((device) => device.deviceId === deviceId)
      && status === 'playing' && validLiveCameraSession(session, deviceId) && gaugePanelMatchesDevice(gaugePanel, deviceId)
      && video?.srcObject === session.stream && !session.stream.getVideoTracks()[0].muted
      && video.readyState >= 2 && !video.paused && !video.ended
      && Number.isInteger(video.videoWidth) && Number.isInteger(video.videoHeight)
      && video.videoWidth > 0 && video.videoHeight > 0
      && video.videoWidth <= 4096 && video.videoHeight <= 4096
      && video.videoWidth * video.videoHeight <= 8294400
      && Number.isFinite(lastActivity) && Number.isFinite(now)
      && now >= lastActivity && now - lastActivity <= EVIDENCE_ACTIVITY_LIMIT_MS;
  } catch { return false; }
}

export function captureCameraEvidence(options) {
  if (!canCaptureCameraEvidence(options)) return Promise.reject(new Error('frame-unavailable'));
  const { video, session, deviceId, now } = options;
  const snapshotUtc = new Date(now).toISOString();
  const canvas = document.createElement('canvas');
  const leftWidth = Math.max(640, video.videoWidth);
  const bodyHeight = Math.max(video.videoHeight, 720);
  canvas.width = leftWidth + 900;
  canvas.height = 60 + bodyHeight + 180;
  if (canvas.width * canvas.height > 16000000) return Promise.reject(new Error('capture-unavailable'));
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('capture-unavailable'));
  let gaugeSnapshot;
  try {
    // Copy the currently decoded frame immediately, before any asynchronous work.
    // No new camera request, inference call, server upload or persistent storage.
    context.fillStyle = '#111827'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, (leftWidth - video.videoWidth) / 2, 60, video.videoWidth, video.videoHeight);
    gaugeSnapshot = snapshotGaugePanel(options.gaugePanel, deviceId, session.cameraId);
    context.fillStyle = '#ffffff'; context.font = 'bold 20px sans-serif';
    context.fillText(`CENTRABUS | ${deviceId} | CAMERA + SIX GAUGES`, 20, 36);
    context.fillStyle = '#ffffff'; context.font = '14px monospace';
    const identity = session.cameraId.match(/.{1,64}/g);
    const lines = [`CENTRABUS CAMERA EVIDENCE | ${deviceId}`,
      ...identity.map((part, index) => `${index ? '        ' : 'Camera: '}${part}`),
      `Browser snapshot UTC: ${snapshotUtc}`,
      'Original camera capture UTC: unavailable / not verified',
      'Preview and displayed readings copied together; source-epoch match NOT VERIFIED.',
      'Not a new physical camera capture; compare each original gauge timestamp.'];
    lines.forEach((line, index) => context.fillText(line, 20, 60 + bodyHeight + 26 + index * 22));
  } catch {
    canvas.width = 0; canvas.height = 0;
    return Promise.reject(new Error('capture-unavailable'));
  }
  const filename = `centrabus-${deviceId}-${session.cameraId.replace(/[^A-Za-z0-9_-]/g, '_')}-${snapshotUtc.replace(/[:.]/g, '-')}.png`;
  return new Promise((resolve, reject) => {
    let finished = false;
    let dials;
    const complete = (blob) => {
      if (finished) return;
      finished = true; clearTimeout(timer); dials?.release(); canvas.width = 0; canvas.height = 0;
      if (blob?.size > 0 && blob.type === 'image/png') resolve({ blob, filename, snapshotUtc });
      else reject(new Error('capture-unavailable'));
    };
    const timer = setTimeout(() => complete(null), 8000);
    try {
      dials = decodeGaugeDials(gaugeSnapshot);
      dials.ready.then((images) => {
        if (finished) return;
        try { drawGaugeEvidence(context, gaugeSnapshot, images, leftWidth, 60); canvas.toBlob(complete, 'image/png'); }
        catch { complete(null); }
      }).catch(() => complete(null));
    } catch { complete(null); }
  });
}

// The browser/OS controls the destination. Requesting a download is not proof
// that a user has saved the file; do not report a confirmed disk write.
export function downloadCameraEvidence({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const revoke = URL.revokeObjectURL.bind(URL);
  try {
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.rel = 'noopener';
    document.body.appendChild(link);
    try { link.click(); } finally { link.remove(); }
  } finally {
    setTimeout(() => revoke(url), 1000);
  }
}

// Authenticated still-frame path: this exact image and every displayed value
// must identify the same source capture before any asynchronous PNG work.
export function captureSynchronizedFrame({ image, panel, frame, deviceId, now }) {
  if (document.hidden || !frame?.image.base64 || frame.device_id !== deviceId
    || image?.dataset.captureId !== frame.capture_id || panel?.dataset.captureId !== frame.capture_id
    || !image.complete || !image.naturalWidth || !image.naturalHeight
    || now - Date.parse(frame.captured_at) > 15000 || now < Date.parse(frame.captured_at) - 2000) return Promise.reject(new Error('capture-mismatch'));
  const snapshot = snapshotGaugePanel(panel, deviceId, frame.camera_id);
  if (snapshot.gauges.some((g) => g.capturedAt !== frame.captured_at)) return Promise.reject(new Error('capture-mismatch'));
  const canvas = document.createElement('canvas'); const left = Math.max(640, image.naturalWidth);
  const height = Math.max(720, image.naturalHeight); canvas.width = left + 900; canvas.height = height + 170;
  if (canvas.width * canvas.height > 16000000) return Promise.reject(new Error('capture-too-large'));
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('canvas-unavailable'));
  context.fillStyle = '#f8fafc'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111827'; context.fillRect(0, 0, canvas.width, 50);
  context.drawImage(image, (left - image.naturalWidth) / 2, 50, image.naturalWidth, image.naturalHeight);
  context.fillStyle = '#ffffff'; context.font = 'bold 18px sans-serif';
  context.fillText(`CENTRABUS | ${deviceId} | CAMERA + SIX GAUGES`, 20, 30);
  // Keep the source image's aspect ratio. Use the space below a short preview
  // for readable provenance, not a black void or a stretched/cropped camera.
  const detailsY = 50 + image.naturalHeight + 26;
  const available = height + 50 - detailsY;
  if (available >= 180) {
    context.fillStyle = '#0f172a'; context.font = 'bold 17px sans-serif';
    context.fillText('CAPTURE DETAILS', 20, detailsY);
    context.font = '13px monospace';
    const lines = [`Device: ${deviceId} | Camera: ${frame.camera_id}`, `Bus: ${frame.bus_id}`,
      `Source UTC: ${frame.captured_at}`, ...(`Capture: ${frame.capture_id}`.match(/.{1,66}/g) || []),
      `${image.naturalWidth} x ${image.naturalHeight} | same source capture ID`,
      frame.readings.some(r => r.quality === 'detected') ? 'Only this capture\'s detected values are included.'
        : 'No detected values for this image. Older values NOT copied.',
      'Camera-derived estimates; physical accuracy unverified.'];
    lines.slice(0, Math.floor((available - 24) / 21)).forEach((line, index) =>
      context.fillText(line, 20, detailsY + 26 + index * 21, left - 40));
  }
  context.fillStyle = '#ffffff'; context.fillRect(0, height + 50, canvas.width, 120);
  context.fillStyle = '#e2e8f0'; context.fillRect(0, height + 50, canvas.width, 1);
  context.fillStyle = '#334155';
  context.font = '13px monospace';
  [`Camera: ${frame.camera_id} | Capture: ${frame.capture_id}`, `Original capture UTC: ${frame.captured_at}`,
    `Browser snapshot UTC: ${new Date(now).toISOString()}`, 'Same source capture ID; detection/calibration accuracy NOT VERIFIED.']
    .forEach((text, index) => context.fillText(text, 20, height + 75 + index * 20));
  return new Promise((resolve, reject) => {
    let done = false; const dials = decodeGaugeDials(snapshot);
    const finish = (blob) => { if (done) return; done = true; clearTimeout(timer); dials.release(); canvas.width = 0; canvas.height = 0;
      if (!blob?.size) reject(new Error('capture-unavailable')); else resolve({ blob, filename: `centrabus-${deviceId}-${frame.capture_id.replace(/[^A-Za-z0-9_-]/g, '_')}.png`, snapshotUtc: new Date(now).toISOString() }); };
    const timer = setTimeout(() => finish(null), 8000);
    dials.ready.then((images) => { if (done) return; try { drawGaugeEvidence(context, snapshot, images, left, 50); canvas.toBlob(finish, 'image/png'); } catch { finish(null); } }).catch(() => finish(null));
  });
}
