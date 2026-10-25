'use strict';
const path = require('node:path');
const { validateReleaseFiles, collect } = require('./release-files.cjs');
const root = path.resolve(__dirname, '..');
try {
  const errors = validateReleaseFiles(root);
  if (errors.length) throw Error(errors.join('\n'));
  const current = collect(root);
  console.log(`DASHBOARD_SOURCE=PASS; files=${current.files.length}; Vercel settings aligned; no push/deploy/device access`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
