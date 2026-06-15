// SpeedLogger — always-on adaptive background speed recorder.
//
// Behaviour (per spec):
//   * Baseline: take one GPS reading every 1 minute.
//   * If a reading is > 6 mph, assume you're in a car and switch to a reading
//     every 5 seconds.
//   * Stay at 5s until readings stay < 6 mph continuously for 5 minutes, then
//     drop back to the 1-minute cadence.
//   * Keeps the last 2 hours of readings in localStorage for the history chart.
//
// Limitation: a web page can only run while it is open. Browsers suspend GPS
// and timers when the screen is off or the app is closed, so this records while
// the app is open (a screen Wake Lock keeps it alive in your pocket). True
// always-on background recording requires a native app.

const SpeedLogger = (() => {
  const MPS_TO_MPH = 2.2369362921;
  const THRESHOLD_MPH = 6;        // > this => "in a car"
  const DRIVE_MS = 5_000;         // sampling interval while driving
  const IDLE_MS = 60_000;         // sampling interval while idle
  const COOLDOWN_MS = 5 * 60_000; // time < threshold before leaving "driving"
  const WINDOW_MS = 2 * 60 * 60_000; // 2 hours of history retained
  const MAX_POINTS = 5000;        // safety cap
  const SPEED_CAP_MPH = 250;      // reject absurd GPS-jump readings

  const KEY = { log: 'st_log', on: 'st_logging', mode: 'st_mode', below: 'st_below' };

  // --- persisted state -------------------------------------------------------
  let running = false;
  let isLeader = false;
  let mode = localStorage.getItem(KEY.mode) === 'driving' ? 'driving' : 'idle';
  let belowSince = Number(localStorage.getItem(KEY.below)) || null;

  // --- runtime state ---------------------------------------------------------
  let timer = null;
  let lastPos = null; // { lat, lon, t } for deriving speed when coords.speed is null
  let wakeLock = null;

  // --- storage ---------------------------------------------------------------
  function loadLog() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY.log) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function record(t, mph) {
    const log = loadLog();
    log.push([t, Math.round(mph * 10) / 10]);
    const cutoff = t - WINDOW_MS;
    let pruned = log.filter(([ts]) => ts >= cutoff);
    if (pruned.length > MAX_POINTS) pruned = pruned.slice(pruned.length - MAX_POINTS);
    localStorage.setItem(KEY.log, JSON.stringify(pruned));
  }

  // --- geolocation -----------------------------------------------------------
  function haversine(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function readOnce(cb) {
    if (!('geolocation' in navigator)) return cb(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { speed, latitude, longitude } = pos.coords;
        const fix = { lat: latitude, lon: longitude, t: pos.timestamp };
        let mph;
        if (speed != null && !Number.isNaN(speed) && speed >= 0) {
          mph = speed * MPS_TO_MPH;
        } else if (lastPos) {
          const dt = (fix.t - lastPos.t) / 1000;
          mph = dt > 0 ? (haversine(lastPos, fix) / dt) * MPS_TO_MPH : 0;
        } else {
          mph = 0;
        }
        lastPos = fix;
        if (mph > SPEED_CAP_MPH) mph = 0; // GPS glitch
        cb(Math.max(0, mph));
      },
      () => cb(null),
      { enableHighAccuracy: true, maximumAge: mode === 'driving' ? 2000 : 30000, timeout: 20000 }
    );
  }

  // --- state machine ---------------------------------------------------------
  function setMode(m) {
    if (m === mode) return;
    mode = m;
    localStorage.setItem(KEY.mode, m);
    emitChange();
  }

  function setBelow(v) {
    belowSince = v;
    if (v) localStorage.setItem(KEY.below, String(v));
    else localStorage.removeItem(KEY.below);
  }

  function updateMode(mph, t) {
    if (mph > THRESHOLD_MPH) {
      setMode('driving');
      setBelow(null);
    } else if (mode === 'driving') {
      if (!belowSince) setBelow(t);
      if (t - belowSince >= COOLDOWN_MS) {
        setMode('idle');
        setBelow(null);
      }
    }
  }

  function scheduleNext() {
    if (!running || !isLeader) return;
    clearTimeout(timer);
    timer = setTimeout(tick, mode === 'driving' ? DRIVE_MS : IDLE_MS);
  }

  function tick() {
    readOnce((mph) => {
      const t = Date.now();
      if (mph != null) {
        record(t, mph);
        updateMode(mph, t);
        window.dispatchEvent(
          new CustomEvent('speedsample', { detail: { mph, t, mode } })
        );
      }
      scheduleNext();
    });
  }

  // --- wake lock (keep screen alive so recording continues in-pocket) --------
  async function acquireWake() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* user can deny; ignore */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (running && document.visibilityState === 'visible') {
      acquireWake();
      if (isLeader) tick(); // catch up immediately when refocused
    }
  });

  // --- leader election (only one open tab records, via Web Locks) -------------
  function becomeLeader() {
    isLeader = true;
    acquireWake();
    tick(); // immediate first reading, then it self-schedules
  }

  function claimLeadership() {
    if ('locks' in navigator) {
      // Holds the lock for the tab's lifetime; the promise never resolves.
      navigator.locks.request('speed-logger', { mode: 'exclusive' }, () =>
        new Promise(() => becomeLeader())
      );
    } else {
      becomeLeader();
    }
  }

  // --- events ----------------------------------------------------------------
  function emitChange() {
    window.dispatchEvent(
      new CustomEvent('speedlogchange', { detail: { on: running, mode } })
    );
  }

  // --- public API ------------------------------------------------------------
  function start() {
    if (running) return;
    running = true;
    localStorage.setItem(KEY.on, 'on');
    emitChange();
    claimLeadership();
  }

  function stop() {
    running = false;
    isLeader = false;
    localStorage.setItem(KEY.on, 'off');
    clearTimeout(timer);
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    emitChange();
  }

  function clear() {
    localStorage.removeItem(KEY.log);
    window.dispatchEvent(new CustomEvent('speedsample', { detail: { cleared: true } }));
  }

  function getHistory() {
    const cutoff = Date.now() - WINDOW_MS;
    return loadLog()
      .filter(([t]) => t >= cutoff)
      .map(([t, v]) => ({ t, v }));
  }

  // --- UI auto-wiring (works on any page that includes the elements) ---------
  function wireUI() {
    const btn = document.getElementById('recordToggle');
    const status = document.getElementById('logStatus');

    function render() {
      if (btn) {
        btn.classList.toggle('on', running);
        btn.setAttribute('aria-pressed', String(running));
        btn.textContent = running ? '● Recording' : '○ Start recording';
      }
      if (status) {
        if (!running) {
          status.textContent = 'Background recording is off.';
        } else {
          const cadence = mode === 'driving' ? 'every 5s (driving)' : 'every 1 min (idle)';
          status.textContent = `Recording ${cadence}.`;
        }
      }
    }

    if (btn) btn.addEventListener('click', () => (running ? stop() : start()));
    window.addEventListener('speedlogchange', render);
    window.addEventListener('speedsample', render);
    render();
  }

  // --- init ------------------------------------------------------------------
  function init() {
    wireUI();
    if (localStorage.getItem(KEY.on) === 'on') start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    start,
    stop,
    clear,
    getHistory,
    isOn: () => running,
    getMode: () => mode,
    THRESHOLD_MPH,
    WINDOW_MS,
  };
})();

window.SpeedLogger = SpeedLogger;
