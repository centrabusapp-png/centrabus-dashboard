# Dashboard edits and future launch

The active Windows source is `superbus/` inside the CentraBus workspace. Continue
editing pages there. `dashboard-publication/` is the Git checkout used to publish
that source; `local-testing/pi2-dashboard-release/` is a separate cloud branch.
The outer workspace is not a Git repository. Never push the entire workspace as
the dashboard, and never publish a snapshot reconstructed from an old commit.

## Prepare the current code

Open `13 - Prepare Dashboard for GitHub.cmd` from the workspace. It reads the
latest active frontend, excludes local environments/queues/captures/backups,
backs up changed publication files, refreshes the public source manifest, runs
deployment regressions and a real production build. It does not stage, commit,
push, deploy, install dependencies or contact a Pi/database. Existing dependencies
must already be installed with the locked package file.

The command uses the latest files every time. If you edit while verification is
running, it refuses to call that version ready. Deleted source files and changed
files in a publication copy require review; no recursive cleanup is performed.
The previous publication bytes are retained under `local-backups/`.

For a quick source/config check, run `npm run check:release` from this frontend.
For a fresh production-build receipt, run `npm run ready:launch` using Node 22.x.
The Windows preparation launcher automatically selects the verified bundled Node.
Local development environment files remain unchanged; the production check takes
only public Supabase configuration and the launch profile's public backend URL.

## When the operator requests git push

1. Run preparation again against the newest active code.
2. Review the diff in `dashboard-publication/`, commit the intended frontend changes,
   then push only the branch the operator selected. Do not merge branches implicitly.
3. The installed pre-push hook refuses dirty/uncommitted work, a stale build receipt,
   a different pushed revision, changed active source, manifest drift or private files.
   It does not run git add/commit/push or alter the device.

The hook is a local safeguard, not a server-side policy. A new clone needs its
hook configured. Preparation installs it for this workspace and records the active
source path and Node executable in local Git config, never in public source files.

## Stable Vercel settings

`deployment/launch-profile.json`, `vercel.json` and `package.json` are checked
together. The project uses repository root `.`, Vite, Node 22.x, the checked-in
install/build commands and `dist`. The SPA fallback covers current and future
page URLs, excluding API/Auth/assets/health namespaces. Adding UI pages normally
does not require adding a Vercel rewrite for each page. Application URL/navigation
logic is still the page code's responsibility.

For the stable future workflow, Vercel's Production Branch should track `main`
of `centrabusapp-png/centrabus-dashboard`. The already published
`codex/pi2-cloud-dashboard` branch is a separate preview/review branch. The next
authorized main push will contain the current prepared source. Preparation
does not change Vercel's remote branch tracking or promote a deployment. If the
host is still tracking the review branch, reconcile that one-time setting before
expecting main pushes to update the production URL.

Configure Vercel Production and Preview once with:

| Variable | Value |
| --- | --- |
| VITE_BACKEND_URL | https://centrabus-backend.onrender.com |
| VITE_SUPABASE_URL | https://dagvfzvysdxeapateuwh.supabase.co |
| VITE_SUPABASE_PUBLISHABLE_KEY | Existing project publishable/anon key; supplied privately in Vercel |
| VITE_CAMERA_READINGS_ENABLED | false |
| VITE_WIFI_STATUS_ENABLED | false |
| VITE_CAMERA_FRAMES_ENABLED | true |
| VITE_CLOUD_CAMERA_MODE | approved-cloud-gps-camera |
| VITE_REMOTE_WIFI_ENABLED | false |
| VITE_DEVICE_PRESENCE_ENABLED | false |

All VITE values are public browser configuration. Backend/device secrets never
belong here. `.env.example` is a template, not a credential file. New Vercel
environment values need a new deployment. Dashboard-level overrides should match
the checked-in profile; changing the hosting account is outside a local build check.

The October 25 Pi2 bench trial passed real GPS/history and signed camera
transmission. The launch profile now preserves the accepted camera-frame flags
used in Vercel Production and Preview. This uses the approved HTTPS
backend and native active-admin auth. Manual production Capture downloads to the
browser; it cannot invoke the laptop-only disk writer. Invalid/uncertain readings
remain blank, and physical accuracy is still unverified.

## What readiness does not claim

Passing these checks verifies the current source, deployment settings and build.
It cannot make unfinished page/Pi1 logic correct, guarantee future edits, supply
missing Vercel account variables, or certify actual sensors. On October 25 the
Render backend passed its cloud GPS/camera contract, exact production-dashboard
CORS and negative authentication checks. Actual Pi2 data delivery, automatic
boot, network recovery and vehicle/gauge acceptance remain separate work.

After explicit operator authorization, the current frontend was deployed directly
to Vercel on October 25. Production deployment
`dpl_D9ETJkZGhhyrTZSAJEDx7NGeWbmp` serves the gauge CSV export and preview recovery
fix; its public assets were checked. This direct source deployment has no Git
commit association. Git main still needs a later explicitly requested push of
the then-current prepared source. Local preparation alone never changes the
hosted deployment. Verify the production version and features after future
deployments instead of assuming Git or a successful local build updated the site.

References: https://vercel.com/docs/frameworks/frontend/vite,
https://vercel.com/docs/project-configuration/vercel-json,
https://vercel.com/docs/environment-variables, https://git-scm.com/docs/githooks.
