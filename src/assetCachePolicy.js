// Cache only public, versioned build assets. Never persist API/auth/GPS data.
export function assetCachePolicy(url = '/') {
  const path = url.split('?')[0];
  if (/^\/assets\/[\w.-]+-[\w-]{8}\.(?:js|css)$/.test(path)) {
    return 'public, max-age=31536000, immutable';
  }
  if (/^\/(?:centrabus-[\w-]+|logo192|logo512)\.png$/.test(path)) {
    return 'public, max-age=3600, must-revalidate';
  }
  if (/^\/(?:api|auth|rest|realtime|storage|functions)(?:\/|$)/.test(path) || /\.json$/.test(path)) {
    return 'no-store';
  }
  // HTML must be revalidated so a new build's hashed URLs are always discovered.
  return 'no-cache';
}
