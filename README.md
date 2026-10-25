# CentraBus dashboard

For current-code GitHub preparation and future Vercel launches, read
[`LAUNCHING.md`](LAUNCHING.md). `npm run ready:launch` verifies the current
deployment configuration and production build without pushing or deploying.

The active React/Vite dashboard uses native Supabase Auth and Supabase for
application data and Realtime. It does not initialize Firebase or provide a
Firebase authentication fallback. Access requires a linked
`profiles.auth_user_id`, `role = 'admin'`, and `is_active = true`.

System Health reports the Supabase Realtime subscription lifecycle separately
from GPS freshness. GPS freshness is based on the source capture timestamp;
backend health separately reports packet receipt and fresh telemetry. An open
Realtime channel does not prove that a sender is active or that new GPS fixes
are arriving.

## Local development

Use the frontend's local `.env` for the public Supabase URL and publishable
key. Never put the backend Supabase secret key in this Vite project.

```text
npm.cmd run dev
npm.cmd test -- --watchAll=false
npm.cmd run build
```

## Faster startup and safe static caching

The login/recovery shell loads without Leaflet or the full dashboard. After a
fresh active-admin profile check, the dashboard/map load on demand. Activity
Records code loads only when opening Records. React, Supabase and Leaflet have
separate content-hashed vendor chunks so unchanged library files can be reused.
An interrupted chunk download shows a retry action rather than a blank page.

The best-effort last-login RPC runs in the background, with a five-second abort
timeout, and cannot delay authorized access. Profile authorization itself is
never cached or skipped. `signInNativeAdmin` returns `lastLoginUpdate`, a promise
of the metadata result, instead of a synchronously available success flag.
The existing login/recovery appearance and SDK-native session refresh remain.
The optional Google Fonts stylesheet loads dynamically; the existing system
font fallback remains readable while fonts load or if the request fails.

For faster local use of the optimized build, keep the backend running as usual
and use a separate frontend terminal:

```text
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173`. Preview serves the last build, so source edits
require another build; use `npm.cmd run dev` when actively developing with HMR.
Preview is for local build verification, not an Internet production host.
Neither command starts/restarts the backend or either Raspberry Pi.

The local preview applies these HTTP cache policies:

- Existing content-hashed `/assets/*.js` and `*.css`: one year, immutable.
- Public CentraBus/logo PNGs: one hour, then revalidate.
- HTML/SPA routes: revalidate on every visit to discover current asset hashes.
- Actual JSON/API paths: no-store policy; missing-file HTML fallbacks are
  revalidated, never given immutable headers. This is a static frontend server,
  not the GPS API or a Supabase proxy.

On a different production hosting platform, configure the equivalent static
asset headers there; the Vite preview plugin does not configure external hosts.
Keep previous hashed chunks available during rolling deployments for already
open tabs. If an old tab cannot download a removed chunk, reload the page to
obtain current HTML. Do not give HTML or unhashed assets an immutable lifetime.

No service worker, offline GPS snapshot cache, authorization cache or new
Supabase query/subscription was added. GPS capture timestamps, freshness,
Realtime handling, bounded Records reads and server-side authorization remain
unchanged. Improvements reduce startup payload and blocking work; slow network
requests, map tiles and database service latency may still affect live loading.

## Legacy Firebase / recovery only

Firebase browser SDK code has been removed from the active frontend. The
repository intentionally retains historical Firebase rules, migration SQL,
snapshots, handoffs, and a saved recovery build for audit/rollback context.
Those artifacts are not imported by the Vite entrypoint and are not the
current authentication or data path. Do not run historical migration or
rollback SQL as part of normal dashboard startup.
