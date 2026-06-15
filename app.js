// Speed Tracker — uses the Geolocation API (GPS) to read live speed.
// coords.speed is in meters/second (may be null when stationary or unsupported).

const UNITS = {
  kmh: { label: 'km/h', factor: 3.6, gaugeMax: 160, distLabel: 'km', distFactor: 0.001 },
  mph: { label: 'mph', factor: 2.236936, gaugeMax: 100, distLabel: 'mi', distFactor: 0.000621371 },
};
const GAUGE_CIRCUMFERENCE = 552.92; // 2 * PI * 88, matches CSS

const el = {
  speed: document.getElementById('speed'),
  unitLabel: document.getElementById('unitLabel'),
  unitToggle: document.getElementById('unitToggle'),
  gaugeFill: document.getElementById('gaugeFill'),
  status: document.getElementById('status'),
  maxSpeed: document.getElementById('maxSpeed'),
  avgSpeed: document.getElementById('avgSpeed'),
  distance: document.getElementById('distance'),
  elapsed: document.getElementById('elapsed'),
  startStop: document.getElementById('startStop'),
  reset: document.getElementById('reset'),
  accuracy: document.getElementById('accuracy'),
};

const state = {
  unit: localStorage.getItem('unit') || 'kmh',
  tracking: false,
  watchId: null,
  maxMs: 0,            // max speed in m/s
  sumMs: 0,            // sum of samples for average
  samples: 0,
  distanceM: 0,        // total distance in meters
  lastFix: null,       // { lat, lon } for distance integration
  startTime: null,
  timerId: null,
};

// ---- Helpers ----------------------------------------------------------------

function unit() { return UNITS[state.unit]; }

function msToUnit(ms) { return ms * unit().factor; }

function haversine(a, b) {
  const R = 6371000; // meters
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---- Rendering --------------------------------------------------------------

function renderSpeed(ms) {
  const v = msToUnit(ms);
  el.speed.textContent = v.toFixed(v < 100 ? 1 : 0);
  const frac = Math.min(v / unit().gaugeMax, 1);
  el.gaugeFill.style.strokeDashoffset = String(GAUGE_CIRCUMFERENCE * (1 - frac));
  el.gaugeFill.style.stroke = frac > 0.85 ? 'var(--danger)' : 'var(--accent)';
}

function renderStats() {
  const u = unit();
  el.maxSpeed.textContent = msToUnit(state.maxMs).toFixed(1);
  const avgMs = state.samples ? state.sumMs / state.samples : 0;
  el.avgSpeed.textContent = msToUnit(avgMs).toFixed(1);
  el.distance.textContent = `${(state.distanceM * u.distFactor).toFixed(2)} ${u.distLabel}`;
}

function renderUnit() {
  const u = unit();
  el.unitLabel.textContent = u.label;
  el.unitToggle.textContent = u.label;
  renderStats();
}

// ---- Tracking ---------------------------------------------------------------

function onPosition(pos) {
  const { speed, latitude, longitude, accuracy } = pos.coords;

  // Derive speed from position deltas if the device doesn't report speed.
  let ms = speed;
  const fix = { lat: latitude, lon: longitude, t: pos.timestamp };
  if (state.lastFix) {
    const d = haversine(state.lastFix, fix);
    state.distanceM += d;
    if (ms == null || Number.isNaN(ms)) {
      const dt = (fix.t - state.lastFix.t) / 1000;
      ms = dt > 0 ? d / dt : 0;
    }
  }
  state.lastFix = fix;
  ms = Math.max(0, ms || 0);

  state.maxMs = Math.max(state.maxMs, ms);
  state.sumMs += ms;
  state.samples += 1;

  renderSpeed(ms);
  renderStats();
  el.status.textContent = 'Tracking…';
  el.accuracy.textContent = accuracy ? `GPS accuracy: ±${Math.round(accuracy)} m` : '';
}

function onError(err) {
  const messages = {
    1: 'Location permission denied. Enable it in your browser settings.',
    2: 'Position unavailable. Make sure GPS/location is on.',
    3: 'Location request timed out. Trying again…',
  };
  el.status.textContent = messages[err.code] || `Error: ${err.message}`;
}

function tickTimer() {
  if (state.startTime) el.elapsed.textContent = formatTime(Date.now() - state.startTime);
}

function start() {
  if (!('geolocation' in navigator)) {
    el.status.textContent = 'Geolocation is not supported on this device.';
    return;
  }
  state.tracking = true;
  state.lastFix = null;
  state.startTime = state.startTime || Date.now();
  el.startStop.textContent = 'Stop';
  el.startStop.classList.add('tracking');
  el.status.textContent = 'Acquiring GPS…';

  state.watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000,
  });
  state.timerId = setInterval(tickTimer, 1000);
}

function stop() {
  state.tracking = false;
  if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
  if (state.timerId) clearInterval(state.timerId);
  state.watchId = null;
  state.timerId = null;
  el.startStop.textContent = 'Start';
  el.startStop.classList.remove('tracking');
  el.status.textContent = 'Stopped';
  el.accuracy.textContent = '';
  renderSpeed(0);
}

function reset() {
  stop();
  state.maxMs = 0;
  state.sumMs = 0;
  state.samples = 0;
  state.distanceM = 0;
  state.lastFix = null;
  state.startTime = null;
  el.elapsed.textContent = '0:00';
  el.status.textContent = 'Tap Start to begin tracking';
  renderSpeed(0);
  renderStats();
}

// ---- Wiring -----------------------------------------------------------------

el.startStop.addEventListener('click', () => (state.tracking ? stop() : start()));
el.reset.addEventListener('click', reset);
el.unitToggle.addEventListener('click', () => {
  state.unit = state.unit === 'kmh' ? 'mph' : 'kmh';
  localStorage.setItem('unit', state.unit);
  renderUnit();
});

renderUnit();
renderSpeed(0);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
