import { LIVE_GAUGE_KEYS, LIVE_GAUGE_TITLES } from '../liveCameraGaugeModel';

export function evidencePanel(deviceId = 'GPS-001') {
  const panel = document.createElement('section'); panel.dataset.deviceId = deviceId;
  panel.innerHTML = `<p class="camera-section-detail">${deviceId} · TEST BUS</p>
    <div class="camera-condition-source"><strong>Reading Available</strong></div>`;
  LIVE_GAUGE_KEYS.forEach((key, index) => {
    const node = document.createElement('article'); node.dataset.gaugeKey = key;
    node.innerHTML = `<h3>${LIVE_GAUGE_TITLES[key]}</h3>
      <svg class="camera-condition-dial" viewBox="0 0 200 116"><g class="camera-gauge-needle" style="transform:rotate(12deg);transform-origin:100px 94px"><path d="M 0 0 L 1 1"/></g></svg>
      <div class="camera-gauge-value">${index + 10}<span>fixture unit</span></div>
      <p class="camera-gauge-angle">Angle: 115.02°</p>
      <div class="camera-gauge-quality">Validated reading</div>
      <p class="camera-gauge-capture"><time datetime="1970-01-01T00:00:01.000Z">00:00:01</time> · 0s ago</p>
      <p class="camera-gauge-confidence">Confidence 95%</p>`;
    panel.appendChild(node);
  });
  return panel;
}

export function mockEvidenceImages() {
  return jest.spyOn(window, 'Image').mockImplementation(() => {
    const image = { onload: null, onerror: null };
    Object.defineProperty(image, 'src', { set(value) {
      if (value) Promise.resolve().then(() => image.onload?.());
    } });
    return image;
  });
}
