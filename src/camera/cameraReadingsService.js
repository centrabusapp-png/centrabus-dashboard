import { CAMERA_READING_COLUMNS } from './cameraReadings';
export const pendingCameraReadingsService = Object.freeze({
  async readLatest() { throw new Error('camera-read-integration-not-approved'); },
});
// Prepared read-only adapter. Approval is a caller's explicit deployment gate,
// NOT authorization. Native session/RLS must enforce active-admin access.
// No service key, select(*), writes, subscriptions or image reads.
export function createSupabaseCameraReadingsService({ client, approved = false } = {}) {
  return {
    async readLatest(busId, { signal } = {}) {
      if (!approved || !client || typeof busId !== 'string' || !busId || busId.length > 128) throw new Error('camera-read-integration-not-approved');
      const assignment = async () => {
        const { data, error } = await client.from('camera_devices').select('camera_id,bus_id,enabled')
          .eq('bus_id', busId).eq('enabled', true).order('camera_id').limit(3).abortSignal(signal);
        if (error || !Array.isArray(data)) throw new Error('camera-read-unavailable');
        return data;
      };
      const cameras = await assignment();
      if (cameras.length !== 1) return { cameras, readings: [] };
      const { data, error } = await client.from('camera_latest_gauge_readings').select(CAMERA_READING_COLUMNS.join(','))
        .eq('bus_id', busId).eq('camera_id', cameras[0].camera_id).order('gauge_key').limit(7).abortSignal(signal);
      if (error || !Array.isArray(data)) throw new Error('camera-read-unavailable');
      const finalCameras = await assignment();
      if (JSON.stringify(finalCameras) !== JSON.stringify(cameras)) throw new Error('camera-assignment-changed');
      return { cameras, readings: data };
    },
  };
}
