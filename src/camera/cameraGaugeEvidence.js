import { LIVE_GAUGE_KEYS } from './liveCameraGaugeModel';

export function gaugePanelMatchesDevice(panel, deviceId) {
  return panel?.dataset.deviceId === deviceId && LIVE_GAUGE_KEYS.every((key) =>
    panel.querySelectorAll(`[data-gauge-key="${key}"]`).length === 1)
    && panel.querySelectorAll('[data-gauge-key]').length === 6;
}

const text = (node, selector) => (node.querySelector(selector)?.textContent || '').trim().slice(0, 256);

// Freeze visible values AND the current animated SVG transforms in this same
// synchronous click turn. Later polling/animation cannot change the export.
export function snapshotGaugePanel(panel, deviceId, cameraId) {
  if (!gaugePanelMatchesDevice(panel, deviceId)) throw new Error('gauge-panel-unavailable');
  const gauges = LIVE_GAUGE_KEYS.map((key) => {
    const node = panel.querySelector(`[data-gauge-key="${key}"]`);
    if (node.dataset.cameraId && node.dataset.cameraId !== cameraId) throw new Error('gauge-camera-mismatch');
    const svg = node.querySelector('svg.camera-condition-dial');
    if (!svg || svg.querySelector('image, use, foreignObject, script') || svg.querySelectorAll('*').length > 100) {
      throw new Error('gauge-dial-unavailable');
    }
    const clone = svg.cloneNode(true);
    // React creates SVG nodes in the SVG namespace without an explicit xmlns
    // attribute. A plain setAttribute produces a second xmlns during XML
    // serialization, which browsers reject when decoding the capture image.
    clone.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', '240'); clone.setAttribute('height', '140');
    for (const original of svg.querySelectorAll('text, .camera-gauge-needle')) {
      const index = [...svg.querySelectorAll('*')].indexOf(original);
      const target = clone.querySelectorAll('*')[index];
      const style = getComputedStyle(original);
      if (original.matches('.camera-gauge-needle')) {
        target.style.transform = style.transform || original.style.transform;
        target.style.transformOrigin = style.transformOrigin || original.style.transformOrigin;
        target.style.transition = 'none';
      } else {
        target.style.fill = style.fill || '#64748b';
        target.style.fontSize = style.fontSize || '8px';
        target.style.fontFamily = 'sans-serif';
        target.style.fontWeight = style.fontWeight || '600';
      }
    }
    const svgText = new XMLSerializer().serializeToString(clone);
    if (svgText.length > 30000) throw new Error('gauge-dial-unavailable');
    return { key, title: text(node, 'h3'),
      value: node.querySelector('.camera-gauge-value')?.firstChild?.textContent?.trim().slice(0, 64) || '—',
      unit: text(node, '.camera-gauge-value span'), status: text(node, '.camera-gauge-quality'),
      capturedAt: node.querySelector('time')?.getAttribute('datetime') || null,
      captureLabel: text(node, '.camera-gauge-capture'), confidence: text(node, '.camera-gauge-confidence'), svgText };
  });
  return { deviceId, association: text(panel, '.camera-section-detail'),
    status: text(panel, '.camera-condition-source strong'), gauges };
}

// Only our bounded, self-contained SVG is decoded. No foreign content, remote
// resources, DOM screenshot library or camera/network request is involved.
export function decodeGaugeDials(snapshot) {
  const images = [];
  const ready = Promise.all(snapshot.gauges.map((gauge) => new Promise((resolve, reject) => {
    const image = new Image(); images.push(image);
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('gauge-image-unavailable'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(gauge.svgText)}`;
  })));
  return { ready, release: () => images.forEach((image) => { image.onload = null; image.onerror = null; image.src = ''; }) };
}

export function drawGaugeEvidence(context, snapshot, images, left, top) {
  context.fillStyle = '#f8fafc'; context.fillRect(left, top, 900, 720);
  context.fillStyle = '#0f172a'; context.font = 'bold 20px sans-serif';
  context.fillText('VEHICLE CONDITION — DISPLAYED READINGS', left + 20, top + 30, 860);
  context.font = '14px sans-serif';
  context.fillText(snapshot.association, left + 20, top + 54, 860);
  context.fillText(snapshot.status || 'Readings not verified', left + 20, top + 76, 860);
  snapshot.gauges.forEach((gauge, index) => {
    const x = left + (index % 3) * 300 + 10, y = top + 92 + Math.floor(index / 3) * 310;
    context.fillStyle = '#ffffff'; context.fillRect(x, y, 280, 298);
    context.fillStyle = '#334155'; context.font = 'bold 17px sans-serif';
    context.fillText(gauge.title, x + 16, y + 27, 250);
    context.drawImage(images[index], x + 20, y + 34, 240, 140);
    context.fillStyle = '#0f172a'; context.font = 'bold 25px sans-serif';
    context.fillText(gauge.value, x + 16, y + 196, 250);
    context.font = '14px sans-serif'; context.fillText(gauge.unit, x + 16, y + 216, 250);
    context.fillStyle = '#64748b'; context.font = '12px sans-serif';
    context.fillText(gauge.status, x + 16, y + 236, 250);
    context.fillText(gauge.capturedAt || gauge.captureLabel, x + 16, y + 255, 250);
    context.fillText(gauge.confidence, x + 16, y + 275, 250);
  });
}
