import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetCachePolicy } from './src/assetCachePolicy.js';

function previewAssetCaching() {
  return {
    name: 'centrabus-preview-asset-cache',
    configurePreviewServer(server) {
      const dist = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '/').split('?')[0];
        const policy = assetCachePolicy(path);
        // Do not give missing assets/SPA fallbacks immutable cache headers.
        const publicFile = policy.startsWith('public,') && existsSync(resolve(dist, `.${path}`));
        res.setHeader('Cache-Control', publicFile ? policy : policy.startsWith('public,') ? 'no-cache' : policy);
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), previewAssetCaching()],
    build: {
      manifest: true,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'react-vendor', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/ },
              { name: 'supabase-vendor', test: /node_modules[\\/]@supabase[\\/]/ },
              { name: 'map-vendor', test: /node_modules[\\/](?:leaflet|react-leaflet|@react-leaflet)[\\/]/ },
            ],
          },
        },
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
      'process.env.VITE_BACKEND_URL': JSON.stringify(env.VITE_BACKEND_URL || ''),
      'process.env.VITE_WIFI_STATUS_ENABLED': JSON.stringify(env.VITE_WIFI_STATUS_ENABLED || 'false'),
      'process.env.VITE_GPS_INGESTION_URL': JSON.stringify(env.VITE_GPS_INGESTION_URL || ''),
      'process.env.VITE_CAMERA_READINGS_ENABLED': JSON.stringify(env.VITE_CAMERA_READINGS_ENABLED || ''),
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
    },
  };
});
