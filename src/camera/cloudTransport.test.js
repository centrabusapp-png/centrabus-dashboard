import { createCameraFrameService } from './cameraFrameService';
import { resolveBackendConfig } from '../config/backendConfig';

const config = () => resolveBackendConfig({ nodeEnv: 'production', backendUrl: 'https://api.example.test',
  cloudCameraMode: 'approved-cloud-gps-camera' });
const session = async () => ({ data: { session: { access_token: 'synthetic-admin' } } });

test('production camera requests use only approved HTTPS and omit the laptop disk writer', async () => {
  const fetchImpl = jest.fn(async () => ({ ok: false, status: 503 }));
  const service = createCameraFrameService({ development: false, enabled: true, config: config(), getSession: session, fetchImpl });
  expect(service.enabled).toBe(true);
  expect(service.saveCapture).toBeUndefined();
  await expect(service.read('GPS-002', { preview: true })).rejects.toThrow('camera-not-ready');
  expect(fetchImpl).toHaveBeenCalledWith('https://api.example.test/api/camera-frames/devices/GPS-002/latest?preview=1',
    expect.objectContaining({ redirect: 'error', credentials: 'omit', headers: {
      Accept: 'application/json', Authorization: 'Bearer synthetic-admin',
    } }));
});

test('production cannot use a LAN target or enable camera without explicit cloud approval', () => {
  for (const changes of [{ cloudCameraMode: undefined }, { backendUrl: 'http://192.168.1.2:5000' },
    { backendUrl: 'https://127.0.0.1' }, { backendUrl: 'https://api.example.test/other' }]) {
    const resolved = resolveBackendConfig({ nodeEnv: 'production', backendUrl: 'https://api.example.test',
      cloudCameraMode: 'approved-cloud-gps-camera', ...changes });
    expect(createCameraFrameService({ development: false, enabled: true, config: resolved }).enabled).toBe(false);
  }
});
