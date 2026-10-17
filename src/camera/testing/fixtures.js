// AUTOMATED TEST FIXTURES ONLY. No physical units/calibration approval implied.
// Not imported by App or any runtime camera module.
export const TEST_TIME = Date.parse('2026-10-12T04:00:00.000Z');
export const TEST_CALIBRATION = Object.freeze({ approved: true, processor_version: 'test-processor', algorithm_version: 'test-opencv',
  calibration_version: 'test-only', model_artifact_version: null, staleAfterMs: 30_000, maxFutureSkewMs: 2000,
  gauges: { fuel: { unit: 'fixture-unit', min: 0, max: 100, minConfidence: 0.8 },
    oilPressure: { unit: 'fixture-unit', min: 0, max: 100, minConfidence: 0.8 } } });
export function cameraSnapshot(changes = {}) {
  return { cameras: [{ camera_id: 'TEST-CAM-1', bus_id: 'test-bus', enabled: true }], readings: [{
    bus_id: 'test-bus', camera_id: 'TEST-CAM-1', gauge_key: 'fuel', numeric_value: '42.000000', unit: 'fixture-unit', confidence: '0.950000',
    captured_at: new Date(TEST_TIME - 1000).toISOString(), received_at: new Date(TEST_TIME - 500).toISOString(), processed_at: new Date(TEST_TIME).toISOString(),
    processor_version: 'test-processor', algorithm_version: 'test-opencv', calibration_version: 'test-only', model_artifact_version: null, result_status: 'partial', ...changes,
  }] };
}
