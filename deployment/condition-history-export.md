# Saved gauge CSV export

The full-day download supports up to 100,000 original captures per CSV. It
preserves one row per capture, all six gauge values, original capture times,
true zeroes and blank unavailable readings. It never downloads a partial file.

Reads use a fixed receipt-time snapshot and the existing authenticated Render
history API. Requests start at least 800 ms apart to stay below its 90/minute
rate limit. Each page retains its 12-second deadline; a complete export has a
10-minute deadline and can be cancelled when its view closes.

Supabase migration `camera_gauge_history_export_index` adds the read index used
by this route:

```sql
create index if not exists camera_gauge_frames_bus_history_idx
  on public.camera_gauge_frames (bus_id, captured_at, camera_id, capture_id)
  include (received_at);
```

The index matches the route's bus filter and ordered keyset pagination. It also
covers the receipt-time filter for exact counts. The API retains exact counts
to detect truncated result pages. The change does not change saved observations,
enrollment, authentication or row access rules.
