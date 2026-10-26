/**
 * Production may expose the authenticated live-camera page only when the
 * approved HTTPS camera-frame service is actually enabled. Development keeps
 * the page available so operators can diagnose an unconfigured feed.
 */
export function liveCameraAvailable(nodeEnv, frameServiceEnabled) {
  return nodeEnv !== 'production' || frameServiceEnabled === true;
}
