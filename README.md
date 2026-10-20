# CentraBus dashboard

## Camera display update

The opt-in authenticated frame view now clears all six displayed readings and
pauses browser camera reads with Preview OFF. Preview ON shows fresh analysis
with original capture time and Fresh/Stale age. This display switch does not
remotely stop the Pi camera process. Missing/stale readings are never zero.
Capture freezes one matching analysis image and its six numeric/quality states;
it never attaches old values to a newer image. Dial labels reuse existing
calibration bands, not new physical/safety limits. Camera accuracy still needs
same-capture physical verification.

During explicitly enabled local development only, manual Capture writes a PNG
to `captured-images` beside the frontend checkout, with loopback Host/Origin,
native active-admin authorization and a fixed generated pathname. It is not an
automatic recorder or cloud file writer. SQL and Pi enrollment/runtime changes
remain separate. Camera/remote-Wi-Fi production flags stay disabled by default.

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

Use Node.js 22.x and run `npm ci --ignore-scripts` to install the locked
dependencies. This repository contains only the active admin frontend, with
its package files at the repository root. It does not contain the Express
backend, Raspberry Pi software, database migrations, historical snapshots or
local environment files.

Use the frontend's local `.env` for the public Supabase URL and publishable
key. Never put the backend Supabase secret key in this Vite project.

```text
npm.cmd run dev
npm.cmd test -- --watchAll=false
npm.cmd run build
```

The two camera cross-component checks in `src/App.test.js` use the sibling
CentraBus backend test harness from the full development workspace. That
backend is intentionally not uploaded here. Running the complete frontend
suite requires that reviewed sibling checkout at `../backend`; this is a test
dependency, not a frontend production-runtime dependency. The Vercel build
does not run those integration tests or start the backend.

## Vercel setup

Import `centrabusapp-png/centrabus-dashboard` and leave **Root Directory** at
the repository root (`.`), not `superbus`. `vercel.json` already selects Vite,
`npm ci --ignore-scripts`, `npm run build:vercel`, and output directory `dist`.
Use Node.js 22.x.

Configure these values in the appropriate Vercel environment before building:

| Variable | Required value |
| --- | --- |
| `VITE_SUPABASE_URL` | The approved public HTTPS Supabase origin |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The project's public publishable/anon key, never a secret/service-role key |
| `VITE_BACKEND_URL` | The approved, separately hosted backend's public HTTPS origin; localhost is not usable by remote visitors |
| `VITE_WIFI_STATUS_ENABLED` | `false` |
| `VITE_CAMERA_READINGS_ENABLED` | `false` |

All `VITE_` values are public browser configuration. Never add a device secret,
password, private key, access/refresh token or backend credential here. No
production environment values are committed. Missing/unsafe configuration
causes the deployment build guard to fail closed.

Before accepting a live release, separately approve the deployed dashboard
origin in backend CORS and configure the corresponding Supabase Auth site and
recovery redirect URLs. Those production changes are not performed by this
repository upload. Verify native active-admin login, logout/recovery, direct
route refreshes, backend reachability, GPS freshness and Realtime on the actual
deployment. A build pass is not a live integration pass.

Vercel hosts this static frontend only. This upload does not deploy the
Express backend or either Raspberry Pi, enable camera/Wi-Fi operations, enroll
devices, modify GPS boot configuration or apply SQL. Real Wi-Fi mutation
remains disabled pending a separately approved device integration.

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
full CentraBus development workspace retains historical Firebase rules, migration SQL,
snapshots, handoffs, and a saved recovery build for audit/rollback context.
Those artifacts are excluded from this frontend-only repository. They are not
imported by the Vite entrypoint and are not the
current authentication or data path. Do not run historical migration or
rollback SQL as part of normal dashboard startup.
