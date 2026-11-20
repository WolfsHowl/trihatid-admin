// driver-tracker.js — shares the driver's live position with every active ride.
// Needs supabase.js loaded first. Used by driver-pickup.html and driver-on-trip.html.
(function () {
  const ACTIVE = ['accepted', 'ongoing', 'active', 'arriving'];
  const MIN_INTERVAL_MS = 3000;   // never write to the database more often than this
  const MIN_MOVE_M = 5;           // ...unless the driver moved at least this far

  function dist(a, b, c, d) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (c - a) * rad, dLng = (d - b) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  // start(driverId, onPosition) -> { stop() }
  function start(driverId, onPosition) {
    let stopped = false;
    let last = null;          // { lat, lng, t }
    let watchId = null;
    let nativeId = null;
    let writing = false;

    async function push(lat, lng) {
      if (writing || !driverId) return;
      writing = true;
      try {
        const base = { driver_lat: lat, driver_lng: lng };
        let { error } = await _supabase.from('rides')
          .update({ ...base, driver_location_at: new Date().toISOString() })
          .eq('driver_id', driverId).in('status', ACTIVE);
        // Older databases don't have driver_location_at yet; retry with coordinates only.
        if (error && /driver_location_at/i.test(error.message || '')) {
          await _supabase.from('rides').update(base)
            .eq('driver_id', driverId).in('status', ACTIVE);
        }
      } catch (e) {
        console.warn('Location share failed (will retry on next fix):', e);
      } finally {
        writing = false;
      }
    }

    function handle(lat, lng) {
      if (stopped || typeof lat !== 'number' || typeof lng !== 'number') return;
      try { if (onPosition) onPosition(lat, lng); } catch (e) { console.warn(e); }
      const now = Date.now();
      if (last && now - last.t < MIN_INTERVAL_MS && dist(last.lat, last.lng, lat, lng) < MIN_MOVE_M) return;
      if (last && now - last.t < 1000) return;
      last = { lat, lng, t: now };
      push(lat, lng);
    }

    const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation;
    if (cap && cap.watchPosition) {
      Promise.resolve(cap.requestPermissions && cap.requestPermissions().catch(() => {}))
        .then(() => cap.watchPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 2000 }, (pos, err) => {
          if (err || !pos) return;
          handle(pos.coords.latitude, pos.coords.longitude);
        }))
        .then(id => { nativeId = id; if (stopped && id) cap.clearWatch({ id }); })
        .catch(e => console.warn('Native geolocation failed:', e));
    } else if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        p => handle(p.coords.latitude, p.coords.longitude),
        err => console.warn('Geolocation error:', err && err.message),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
      );
    }

    // Re-send the last known spot when the app comes back to the foreground
    // so the passenger isn't left with a stale pin after the phone slept.
    const onVisible = () => { if (!document.hidden && last) push(last.lat, last.lng); };
    document.addEventListener('visibilitychange', onVisible);

    return {
      stop() {
        stopped = true;
        document.removeEventListener('visibilitychange', onVisible);
        if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
        if (nativeId && cap) cap.clearWatch({ id: nativeId });
      }
    };
  }

  window.TriTracker = { start };
})();
