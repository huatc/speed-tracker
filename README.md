# Speed Tracker

A phone speedometer web app (installable PWA). It reads your live speed from the
device's GPS via the browser **Geolocation API** and displays it on a gauge, while
recording max speed, average speed, distance, and elapsed time for the session.

## Features
- Live speed on a circular gauge (turns red near the top of the range)
- Toggle between **km/h** and **mph** (remembered between sessions)
- Records **max**, **average**, **distance**, and **elapsed time**
- Start / Stop / Reset controls
- Falls back to position-delta speed if the device doesn't report `coords.speed`
- Works offline once loaded (service worker) and is installable to the home screen

## Running it

GPS speed requires a **secure context** — `https://` or `localhost`. Opening
`index.html` directly from the file system will not grant location access.

Serve the folder over HTTP locally:

```sh
# Python
python -m http.server 8000

# or Node
npx serve .
```

Then open `http://localhost:8000`.

### Using it on your phone
The phone needs HTTPS (not your PC's `localhost`). Options:
- Deploy the folder to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages).
- Or run a local HTTPS tunnel (e.g. `npx localtunnel --port 8000` or `ngrok http 8000`)
  and open the https URL on the phone.

Once open on the phone, tap **Start**, allow location access, and go for a walk or
drive. For best results keep the screen on and grant "high accuracy" location.

## Notes
- Speed accuracy depends on GPS quality; readings are noisy when stationary or indoors.
- This is a client-only app — no data leaves the device.
