const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDeploymentConfig } = require('./check-deployment-config.cjs');
test('production camera activation requires its explicit cloud mode; legacy operations stay disabled', () => {
  const env = { VITE_BACKEND_URL: 'https://api.example.test', VITE_SUPABASE_URL: 'https://db.example.test',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_only', VITE_CAMERA_FRAMES_ENABLED: 'true' };
  assert.ok(validateDeploymentConfig(env).length);
  assert.deepEqual(validateDeploymentConfig({ ...env, VITE_CLOUD_CAMERA_MODE: 'approved-cloud-gps-camera' }), []);
  assert.ok(validateDeploymentConfig({ ...env, VITE_CLOUD_CAMERA_MODE: 'true' }).length);
  assert.ok(validateDeploymentConfig({ ...env, VITE_CLOUD_CAMERA_MODE: 'approved-cloud-gps-camera', VITE_WIFI_STATUS_ENABLED: 'true' }).length);
});
