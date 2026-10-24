// Checks variable SHAPES only. No dotenv, SDK, network, device or secret output.
function publicOrigin(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash
      && !host.includes('*') && host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.local')
      && !host.startsWith('[') && !/^(?:0|10|127)\./.test(host)
      && !/^169\.254\./.test(host) && !/^192\.168\./.test(host)
      && !/^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
  } catch { return false; }
}

function publishableKey(value) {
  if (typeof value !== 'string' || value.startsWith('sb_secret_')) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const parts = value.split('.');
    return parts.length === 3 && JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'anon';
  } catch { return false; }
}

function validateDeploymentConfig(env) {
  const errors = [];
  if (!publicOrigin(env.VITE_BACKEND_URL)) errors.push('VITE_BACKEND_URL must be an approved public HTTPS origin, with no path or credentials.');
  if (!publicOrigin(env.VITE_SUPABASE_URL)) errors.push('VITE_SUPABASE_URL must be the approved HTTPS Supabase origin.');
  if (!publishableKey(env.VITE_SUPABASE_PUBLISHABLE_KEY)) errors.push('Supply a Supabase publishable/anon key, never a backend secret/service-role key.');
  for (const flag of ['VITE_CAMERA_READINGS_ENABLED', 'VITE_WIFI_STATUS_ENABLED']) {
    if (env[flag] != null && env[flag] !== '' && env[flag] !== 'false') errors.push(`${flag} must remain false for this release.`);
  }
  if (env.VITE_CAMERA_FRAMES_ENABLED === 'true' && env.VITE_CLOUD_CAMERA_MODE !== 'approved-cloud-gps-camera') {
    errors.push('Cloud camera frames require the explicit approved-cloud-gps-camera mode.');
  }
  if (env.VITE_CLOUD_CAMERA_MODE && env.VITE_CLOUD_CAMERA_MODE !== 'approved-cloud-gps-camera') {
    errors.push('Unknown public cloud camera mode.');
  }
  if (Object.keys(env).some((name) => name.startsWith('VITE_')
      && /SECRET|PASSWORD|PRIVATE|SERVICE.?ROLE|DEVICE.?KEY|ACCESS.?TOKEN|REFRESH.?TOKEN/i.test(name))) {
    errors.push('Remove private credential variables from the public VITE_ namespace.');
  }
  return errors;
}

if (require.main === module) {
  const errors = validateDeploymentConfig(process.env);
  if (errors.length) {
    console.error('Deployment configuration rejected (values redacted):');
    for (const message of errors) console.error(`- ${message}`);
    process.exitCode = 1;
  } else console.log('Public deployment configuration shape accepted; no connectivity or authorization test was performed.');
}

module.exports = { validateDeploymentConfig, publicOrigin, publishableKey };
