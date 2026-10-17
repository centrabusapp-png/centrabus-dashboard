import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Separate loopback-only preview; does not load project .env or public assets.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: false,
  publicDir: false,
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4319, strictPort: true },
});
