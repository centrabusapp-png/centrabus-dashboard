import { decodeGaugeDials, drawGaugeEvidence, gaugePanelMatchesDevice, snapshotGaugePanel } from './cameraGaugeEvidence';
import { captureCameraEvidence } from './cameraEvidence';
import { evidencePanel, mockEvidenceImages } from './testing/evidenceFixtures';

afterEach(() => jest.restoreAllMocks());

test('six displayed gauges freeze values, units, timestamps, confidence and actual animated needle transform', () => {
  const panel = evidencePanel();
  const snapshot = snapshotGaugePanel(panel, 'GPS-001', 'test-camera');
  expect(snapshot.gauges).toHaveLength(6);
  expect(snapshot.gauges[0]).toMatchObject({ key: 'fuel', title: 'Fuel', value: '10', unit: 'fixture unit',
    capturedAt: '1970-01-01T00:00:01.000Z', status: 'Validated reading', confidence: 'Confidence 95%', angle:'Angle: 115.02°' });
  expect(snapshot.gauges[0].svgText).toContain('rotate(12deg)');
  expect(snapshot.gauges[0].svgText).toContain('transition: none');
  panel.querySelector('.camera-gauge-value').firstChild.textContent = '99';
  panel.querySelector('time').setAttribute('datetime', 'later');
  panel.querySelector('.camera-gauge-needle').style.transform = 'rotate(90deg)';
  panel.querySelector('.camera-gauge-angle').textContent = 'Angle: 90.00°';
  expect(snapshot.gauges[0].value).toBe('10');
  expect(snapshot.gauges[0].capturedAt).toBe('1970-01-01T00:00:01.000Z');
  expect(snapshot.gauges[0].svgText).not.toContain('rotate(90deg)');
  expect(snapshot.gauges[0].angle).toBe('Angle: 115.02°');
});

test('React-style namespace SVG serializes to valid XML without a duplicate xmlns',()=>{
  const panel=evidencePanel();
  for(const svg of panel.querySelectorAll('svg'))svg.removeAttribute('xmlns');
  const snapshot=snapshotGaugePanel(panel,'GPS-001','test-camera');
  for(const gauge of snapshot.gauges){
    const xml=new DOMParser().parseFromString(gauge.svgText,'image/svg+xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    expect(gauge.svgText.match(/xmlns=/g)).toHaveLength(1);
  }
});

test('missing, duplicate, wrong-device or wrong-camera panels cannot silently produce a comparison', () => {
  expect(gaugePanelMatchesDevice(null, 'GPS-001')).toBe(false);
  const wrong = evidencePanel('GPS-002');
  expect(() => snapshotGaugePanel(wrong, 'GPS-001', 'test-camera')).toThrow();
  const missing = evidencePanel(); missing.lastElementChild.remove();
  expect(() => snapshotGaugePanel(missing, 'GPS-001', 'test-camera')).toThrow();
  const duplicate = evidencePanel(); duplicate.appendChild(duplicate.lastElementChild.cloneNode(true));
  expect(() => snapshotGaugePanel(duplicate, 'GPS-001', 'test-camera')).toThrow();
  const mismatch = evidencePanel(); mismatch.querySelector('article').dataset.cameraId = 'other-camera';
  expect(() => snapshotGaugePanel(mismatch, 'GPS-001', 'test-camera')).toThrow('gauge-camera-mismatch');
});

test('missing values and stale readings retain their displayed meaning, never fabricated zero or fresh time', () => {
  const panel = evidencePanel(); const nodes = panel.querySelectorAll('article');
  nodes[0].querySelector('.camera-gauge-value').firstChild.textContent = '—';
  nodes[0].querySelector('.camera-gauge-value span').textContent = 'Awaiting data';
  nodes[0].querySelector('time').remove();
  nodes[1].querySelector('.camera-gauge-quality').textContent = 'Last known · stale';
  const snapshot = snapshotGaugePanel(panel, 'GPS-001', 'test-camera');
  expect(snapshot.gauges[0]).toMatchObject({ value: '—', unit: 'Awaiting data', capturedAt: null });
  expect(snapshot.gauges[1]).toMatchObject({ status: 'Last known · stale', capturedAt: '1970-01-01T00:00:01.000Z' });
});

test.each(['image', 'use', 'foreignObject', 'script'])('unsafe SVG content %s cannot be loaded', (tag) => {
  const panel = evidencePanel();
  panel.querySelector('svg').appendChild(document.createElementNS('http://www.w3.org/2000/svg', tag));
  expect(() => snapshotGaugePanel(panel, 'GPS-001', 'test-camera')).toThrow('gauge-dial-unavailable');
});

test('composition places all six dials to the right, without a new data request', async () => {
  mockEvidenceImages();
  const snapshot = snapshotGaugePanel(evidencePanel(), 'GPS-001', 'test-camera');
  const decoded = decodeGaugeDials(snapshot); const images = await decoded.ready;
  const context = { fillRect: jest.fn(), fillText: jest.fn(), drawImage: jest.fn() };
  drawGaugeEvidence(context, snapshot, images, 960, 60);
  expect(context.drawImage).toHaveBeenCalledTimes(6);
  expect(context.drawImage.mock.calls.every(([, x]) => x > 960)).toBe(true);
  expect(new Set(context.drawImage.mock.calls.map(([, x]) => x)).size).toBe(2);
  expect(new Set(context.drawImage.mock.calls.map(([, , y]) => y)).size).toBe(3);
  expect(snapshot.gauges.map(g => g.key)).toEqual(['fuel','coolant','frontAir','rearAir','battery','oilPressure']);
  const titles = context.fillText.mock.calls.filter(([text]) => snapshot.gauges.some(g => g.title === text));
  expect(titles.map(([title]) => title)).toEqual(['Fuel','Coolant','Front air pressure','Rear air pressure','Battery','Oil']);
  expect(titles[0][2]).toBe(titles[1][2]);
  expect(titles[2][2]).toBe(titles[3][2]);
  expect(titles[4][2]).toBe(titles[5][2]);
  expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(expect.arrayContaining([
    'Fuel', 'Oil', 'Coolant', 'Front air pressure', 'Battery', 'Rear air pressure', '10', 'fixture unit', 'Confidence 95%', 'Angle: 115.02°',
  ]));
  decoded.release();
});

test('SVG decode failures refuse the download, and a stalled decode has a total eight-second bound', async () => {
  jest.useFakeTimers();
  try {
    const track = { kind: 'video', readyState: 'live' };
    const stream = { getVideoTracks: () => [track], getAudioTracks: () => [], getTracks: () => [track] };
    const options = { deviceId: 'GPS-001', status: 'playing', now: 1000, lastActivity: 1000,
      gaugePanel: evidencePanel(), session: { deviceId: 'GPS-001', cameraId: 'test', stream, close() {} },
      video: { srcObject: stream, readyState: 2, paused: false, ended: false, videoWidth: 640, videoHeight: 360 } };
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {}, fillText() {}, drawImage() {} });
    const encode = jest.spyOn(HTMLCanvasElement.prototype, 'toBlob');
    jest.spyOn(window, 'Image').mockImplementation(() => ({}));
    const result = expect(captureCameraEvidence(options)).rejects.toThrow('capture-unavailable');
    jest.advanceTimersByTime(8001); await result;
    expect(encode).not.toHaveBeenCalled();
    window.Image.mockImplementation(() => {
      const image = {};
      Object.defineProperty(image, 'src', { set(value) { if (value) Promise.resolve().then(() => image.onerror?.()); } });
      return image;
    });
    await expect(captureCameraEvidence(options)).rejects.toThrow('capture-unavailable');
    expect(encode).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});
