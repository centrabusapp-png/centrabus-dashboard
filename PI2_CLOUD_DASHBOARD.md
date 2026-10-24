# Pi2 public dashboard candidate

Vercel hosts this frontend; the verified backend origin is https://centrabus-backend.onrender.com. No backend/device credentials belong in this build. Use the public Supabase origin and publishable/anon key only. Initial camera flags remain off until the Render live contract passes.

Camera activation needs VITE_CAMERA_FRAMES_ENABLED=true plus VITE_CLOUD_CAMERA_MODE=approved-cloud-gps-camera. Production camera reads go directly to the configured HTTPS backend with native active-admin authentication; development still uses the loopback proxy. Configure the actual Vercel HTTPS origin in Render CORS. Manual production Capture downloads a PNG in the browser and never calls the laptop-only disk writer. Saved-reading CSV preserves original capture epochs and null values. Physical gauge accuracy remains unverified.

Enable no Wi-Fi mutation or legacy camera-reading flag. Supabase Auth site/recovery URLs and native login must be verified on the actual public deployment.
