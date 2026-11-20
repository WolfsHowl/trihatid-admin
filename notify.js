// notify.js — shared helpers: sound, in-app alerts, vibration, SMS queue, small utilities.
// Load AFTER supabase.js on every page that needs it.
(function () {
  const PREF_KEYS = { sound: 'tri_pref_sound', vibrate: 'tri_pref_vibrate', sms: 'tri_pref_sms' };

  // ---------- small utilities ----------
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function once(key) {            // true only the first time per browser tab session
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
    } catch (e) { /* storage blocked: allow */ }
    return true;
  }

  async function writeWithFallback(run, row, optionalKeys) {
    let res = await run(row);
    if (res && res.error && optionalKeys && optionalKeys.length) {
      const slim = Object.assign({}, row);
      optionalKeys.forEach(k => delete slim[k]);
      res = await run(slim);
    }
    return res;
  }

  function shortId(id) {
    const str = String(id || '');
    if (!str) return '--';
    let h1 = 0x811c9dc5, h2 = 5381;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = (Math.imul(h2, 33) + c) >>> 0;
    }
    const n = ((h1 % 10000) * 10000) + (h2 % 10000);
    return String(n).padStart(8, '0');
  }

  // ---------- preferences ----------
  function getPref(name, def) {
    if (def === undefined) def = true;
    try {
      const v = localStorage.getItem(PREF_KEYS[name]);
      return v === null ? def : v === '1';
    } catch (e) { return def; }
  }
  function setPref(name, on) {
    try { localStorage.setItem(PREF_KEYS[name], on ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  // ---------- sound ----------
  let audioCtx = null;
  function ctx() {
    // Check if user has interacted with page to comply with browser autoplay policies
    const isUserActive = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (!isUserActive) return null;

    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  const TONES = {
    request:  [[880, .12], [1175, .12], [880, .12], [1175, .22]],
    accepted: [[523, .12], [659, .12], [784, .28]],
    arriving: [[784, .14], [784, .14], [1047, .32]],
    message:  [[988, .08], [1319, .16]],
    complete: [[784, .12], [659, .12], [523, .12], [784, .3]],
    alert:    [[330, .2], [262, .3]]
  };

  function playSound(name, force) {
    if (!force && !getPref('sound')) return;
    const c = ctx();
    const notes = TONES[name];
    if (!c || !notes) return;
    let t = c.currentTime + 0.02;
    notes.forEach(([freq, dur]) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.28, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur + 0.03;
    });
  }

  ['pointerdown', 'touchstart', 'keydown'].forEach(evt =>
    window.addEventListener(evt, function unlock() {
      ctx();
      window.removeEventListener(evt, unlock);
    }, { passive: true })
  );

  function vibrate(pattern) {
    if (!getPref('vibrate')) return;
    try {
      const active = !navigator.userActivation || navigator.userActivation.hasBeenActive;
      if (active && navigator.vibrate) navigator.vibrate(pattern || [180, 80, 180]);
    } catch (e) { /* ignore */ }
  }

  function toast(title, body) {
    let host = document.getElementById('tri-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'tri-toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'tri-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<strong>${esc(title)}</strong>${body ? `<span>${esc(body)}</span>` : ''}`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 5000);
  }

  // FIXED: autoCancel: false and requireInteraction: true make notifications stick until swiped/tapped
  function notify(opts) {
    toast(opts.title, opts.body);
    if (opts.sound) playSound(opts.sound);
    vibrate(opts.vibrate);
    
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
        const { LocalNotifications } = window.Capacitor.Plugins;
        LocalNotifications.schedule({
          notifications: [
            {
              title: opts.title,
              body: opts.body || '',
              id: opts.id || Math.floor(Math.random() * 1000000),
              schedule: { at: new Date(new Date().getTime() + 100) },
              sound: 'default',
              ongoing: false,
              autoCancel: false, // STAYS in notification tray until manually swiped or tapped
              extra: opts.extra || {}
            }
          ]
        });
      } else if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(opts.title, { body: opts.body || '', icon: 'logo2.png', requireInteraction: true });
      }
    } catch (e) { console.warn('Sticky notification dispatch failed:', e); }
  }

  async function cancelNotification(rideId) {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
        await window.Capacitor.Plugins.LocalNotifications.cancel({
          notifications: [{ id: Number(rideId) }]
        });
      }
    } catch (e) { /* ignore */ }
  }

  async function requestSystemPermission() {
    if (!('Notification' in window)) return 'unsupported';
    try { return await Notification.requestPermission(); } catch (e) { return 'denied'; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
        const { LocalNotifications } = window.Capacitor.Plugins;
        
        LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
          const data = notification.notification?.extra || {};
          const chatId = data.chat_id;
          const otherUserId = data.other_user_id;
          const rideId = data.ride_id;

          if (notification.notification?.id) {
            LocalNotifications.cancel({ notifications: [{ id: notification.notification.id }] });
          }

          if (chatId && otherUserId) {
            window.location.href = `messages.html?chat_id=${chatId}&user=${otherUserId}`;
          } else if (rideId) {
            window.location.href = `passenger-pickup.html?ride_id=${rideId}`;
          }
        });
      }
    } catch (e) {
      console.warn("Local notification tap listener setup failed:", e);
    }
  });

  async function queueSms(rideId, recipientId, event) {
    if (!rideId || !recipientId || !event) return false;
    try {
      const { error } = await window._supabase
        .from('sms_outbox')
        .insert([{ ride_id: rideId, recipient_id: recipientId, event: event }]);
      if (error) { console.warn('SMS not queued:', error.message); return false; }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Automatic first chat message from the driver once they accept a booking.
  function driverGreetingText(driverName) {
    return `Good day, I'm ${driverName || 'your driver'} your Trihatid Driver, on my way to your pickup location.`;
  }

  async function sendDriverGreeting(passengerId, driverId, driverName) {
    if (!passengerId || !driverId) return false;
    try {
      const chatId = [passengerId, driverId].sort().join('_');
      const { error } = await window._supabase.from('messages').insert([{
        chat_id: chatId,
        sender_id: driverId,
        message: driverGreetingText(driverName)
      }]);
      if (error) { console.error('Greeting not sent:', error); try { alert('Ride accepted, but the automatic chat greeting failed: ' + error.message); } catch (e) {} return false; }
      return true;
    } catch (e) {
      return false;
    }
  }

  async function watchMessages() {
    const sb = window._supabase;
    if (!sb || /messages\.html$/i.test(window.location.pathname)) return;
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const nameCache = {};
      async function senderName(id) {
        if (nameCache[id]) return nameCache[id];
        let name = 'Someone';
        try {
          const { data } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
          name = (data && (data.fullname || data.full_name || data.name || data.username)) || name;
        } catch (e) { }
        nameCache[id] = name;
        return name;
      }
      sb.channel('tri_incoming_messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async payload => {
          const m = payload.new || {};
          if (!m.sender_id || m.sender_id === user.id) return;
          if (!m.chat_id || String(m.chat_id).split('_').indexOf(user.id) === -1) return;
          const name = await senderName(m.sender_id);
          notify({ 
            title: name + ' sent a message', 
            body: m.message ? String(m.message).slice(0, 80) : '', 
            sound: 'message', 
            vibrate: [120],
            extra: {
              chat_id: m.chat_id,
              other_user_id: m.sender_id
            }
          });
        })
        .subscribe();
    } catch (e) { }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchMessages);
  else watchMessages();

  window.TriUtil = { esc, distanceMeters, once, writeWithFallback, shortId };
  window.TriPrefs = { get: getPref, set: setPref };
  window.TriSound = { play: playSound, unlock: ctx };
  window.TriChat = { driverGreetingText, sendDriverGreeting };
  window.TriNotify = { notify, toast, vibrate, queueSms, requestSystemPermission, cancel: cancelNotification };
})();
