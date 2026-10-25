# Dashboard release workflow

Read `LAUNCHING.md` before preparing GitHub or Vercel changes. In the Windows
CentraBus workspace, `superbus/` is the active editable frontend; publication
checkouts are outputs. Always prepare from its latest files, not a pinned commit.
The workspace helper is `qa/prepare-dashboard-launch.cjs --prepare`. The standalone
frontend commands are `npm run check:release` and `npm run ready:launch`.

Preserve local page edits, `.env` files and existing index entries. Keep public
hosting settings in `deployment/launch-profile.json` aligned with `vercel.json`.
Do not print/copy backend/device secrets into VITE config. Before an authorized
push, rerun preparation, review the exact diff, and commit the selected changes;
the hook checks fresh source/build evidence. Preparation never authorizes a push,
merge, deployment, Pi operation or unrelated backend change.
