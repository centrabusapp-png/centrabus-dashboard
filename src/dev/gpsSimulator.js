const SIMULATED_ROUTE = [
  { latitude: 14.0889, longitude: 121.1493 },
  { latitude: 14.0895, longitude: 121.1500 },
  { latitude: 14.0902, longitude: 121.1509 },
  { latitude: 14.0909, longitude: 121.1517 },
  { latitude: 14.0916, longitude: 121.1525 },
  { latitude: 14.0922, longitude: 121.1533 },
  { latitude: 14.0918, longitude: 121.1528 },
  { latitude: 14.0912, longitude: 121.1522 },
  { latitude: 14.0906, longitude: 121.1516 },
  { latitude: 14.0900, longitude: 121.1510 },
  { latitude: 14.0894, longitude: 121.1503 },
];

const SIMULATED_SPEEDS = [28, 32, 35, 30, 26, 34];
export const GPS_SIMULATOR_INTERVAL_MS = 1000;
export const GPS_INGESTION_ENDPOINT = process.env.VITE_GPS_INGESTION_URL || 'http://localhost:5000/api/gps/update';
const SEGMENT_STEPS = 8;
const REQUEST_TIMEOUT_MS = 5000;

function interpolatePosition(startPoint, endPoint, progress) {
  return {
    latitude: startPoint.latitude + (endPoint.latitude - startPoint.latitude) * progress,
    longitude: startPoint.longitude + (endPoint.longitude - startPoint.longitude) * progress,
  };
}

export function createGpsSimulator(busId, { intervalMs = GPS_SIMULATOR_INTERVAL_MS, onUpdate, onError } = {}) {
  // This object is created once per Start click and is never recreated by
  // React renders. Every timer tick updates the same route cursor and position.
  const state = {
    timer: null,
    routeIndex: 0,
    routeProgress: 0,
    currentSpeed: SIMULATED_SPEEDS[0],
    currentPosition: { ...SIMULATED_ROUTE[0] },
    tick: 0,
    isRunning: false,
    writeInFlight: false,
  };

  const writePoint = async (online) => {
    if (!busId || (online && !state.isRunning)) return;
    if (state.writeInFlight) {
      if (online) console.warn('GPS simulator tick skipped: request in flight', { busId });
      return;
    }
    state.writeInFlight = true;

    const startPoint = SIMULATED_ROUTE[state.routeIndex];
    const endPoint = SIMULATED_ROUTE[(state.routeIndex + 1) % SIMULATED_ROUTE.length];
    const nextPosition = online
      ? interpolatePosition(startPoint, endPoint, state.routeProgress)
      : state.currentPosition;
    const targetSpeed = SIMULATED_SPEEDS[state.routeIndex % SIMULATED_SPEEDS.length];
    state.currentSpeed += (targetSpeed - state.currentSpeed) * 0.2;
    const tick = online ? state.tick + 1 : state.tick;
    if (online) state.tick = tick;
    const payload = {
      latitude: nextPosition.latitude,
      longitude: nextPosition.longitude,
      speed: online ? Math.round(state.currentSpeed) : 0,
      rawSpeedKmh: online ? Math.round(state.currentSpeed) : 0,
      online,
      // Development packets follow the same contract as the physical sender:
      // this is the time the simulated fix was produced, not a database time.
      capturedAt: new Date().toISOString(),
    };

    const requestController = new AbortController();
    const requestTimeout = setTimeout(() => requestController.abort(), REQUEST_TIMEOUT_MS);
    try {
      if (online) {
        console.log('GPS simulator tick', {
          busId,
          tick,
          latitude: payload.latitude,
          longitude: payload.longitude,
        });
      }
      const response = await fetch(GPS_INGESTION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ busId, ...payload }),
        signal: requestController.signal,
      });
      let responseBody = null;
      try {
        responseBody = await response.json();
      } catch {
        // Keep the error safe when the backend returns a non-JSON response.
      }
      if (!response.ok) {
        const error = new Error(responseBody?.error || `GPS ingestion failed (${response.status})`);
        error.code = `HTTP_${response.status}`;
        throw error;
      }
      if (online) console.log('GPS simulator POST success', { busId, tick });
      if (online) {
        state.currentPosition = nextPosition;
        state.routeProgress += 1 / SEGMENT_STEPS;
        if (state.routeProgress >= 1) {
          state.routeProgress = 0;
          state.routeIndex = (state.routeIndex + 1) % SIMULATED_ROUTE.length;
        }
      }
      try {
        onUpdate?.(payload);
      } catch (callbackError) {
        console.error('GPS simulator update callback failure', callbackError.code || 'CALLBACK_ERROR', callbackError.message);
      }
    } catch (error) {
      if (online) console.error('GPS simulator POST failure', { busId, tick, code: error.code || 'REQUEST_ERROR', message: error.message });
      onError?.(error);
      throw error;
    } finally {
      clearTimeout(requestTimeout);
      state.writeInFlight = false;
    }
  };

  return {
    async start() {
      if (state.isRunning || state.timer || !busId) return;
      state.isRunning = true;
      state.timer = setInterval(() => {
        void writePoint(true).catch(() => {});
      }, intervalMs);
      console.log('GPS simulator timer created', { busId, intervalMs });
      await writePoint(true).catch(() => {});
    },
    async stop({ setOffline = false } = {}) {
      state.isRunning = false;
      console.log('GPS simulator stop', { busId });
      if (state.timer) {
        clearInterval(state.timer);
        console.log('GPS simulator timer cleanup', { busId });
      }
      state.timer = null;
      if (setOffline) await writePoint(false);
    },
  };
}
