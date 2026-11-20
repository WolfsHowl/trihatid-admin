// supabase.js
if (!window._supabase) {
  const SUPABASE_URL = 'https://ynwsauldwhfmlbnrhfhl.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_JHg6iSCw9h9DlRzp463zxg__3tEzREv';

  // Use Capacitor Preferences native storage so sessions survive app closure
  const CapacitorStorage = {
    getItem: async (key) => {
      if (window.Capacitor?.Plugins?.Preferences) {
        const { value } = await window.Capacitor.Plugins.Preferences.get({ key });
        return value;
      }
      return localStorage.getItem(key);
    },
    setItem: async (key, value) => {
      if (window.Capacitor?.Plugins?.Preferences) {
        await window.Capacitor.Plugins.Preferences.set({ key, value });
      } else {
        localStorage.setItem(key, value);
      }
    },
    removeItem: async (key) => {
      if (window.Capacitor?.Plugins?.Preferences) {
        await window.Capacitor.Plugins.Preferences.remove({ key });
      } else {
        localStorage.removeItem(key);
      }
    }
  };

  window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: CapacitorStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  // ---- Stay signed in -------------------------------------------------------
  // getUser() asks the server every time. A weak signal / sleeping phone makes it
  // fail, and the pages treated "no user" as "logged out" and sent people to login.
  // Only a real auth rejection should count as logged out; a network failure falls
  // back to the saved session.
  const auth = window._supabase.auth;
  const originalGetUser = auth.getUser.bind(auth);
  auth.getUser = async function (...args) {
    let res;
    try {
      res = await originalGetUser(...args);
    } catch (e) {
      res = { data: { user: null }, error: e };
    }
    if (res && res.data && res.data.user) return res;

    const err = res && res.error;
    const isNetwork = err && (
      err.name === 'AuthRetryableFetchError' ||
      err.status === 0 || err.status >= 500 ||
      /fetch|network|timeout|failed to load/i.test(err.message || '')
    );
    if (isNetwork) {
      try {
        const { data } = await auth.getSession();
        if (data && data.session && data.session.user) {
          return { data: { user: data.session.user }, error: null };
        }
      } catch (e) { /* fall through */ }
    }
    return res;
  };

  // Helpers shared by every page
  window.TriAuth = {
    // Current user from the saved session (works offline).
    async getUser() {
      const { data } = await auth.getUser();
      return (data && data.user) || null;
    },
    // 'driver' or 'passenger'. Prefers the account itself; localStorage can be wiped by the OS.
    roleOf(user) {
      let r = '';
      try { r = (user && user.user_metadata && user.user_metadata.role) || localStorage.getItem('user_role') || ''; } catch (e) {}
      return String(r || 'passenger').toLowerCase().trim();
    },
    homeFor(user) {
      return this.roleOf(user) === 'driver' ? 'driver-dashboard.html' : 'home.html';
    },
    // On welcome/login/splash: if a saved session exists, skip straight into the app.
    async redirectIfSignedIn() {
      try {
        const { data } = await auth.getSession();
        const user = data && data.session && data.session.user;
        if (user) {
          const role = this.roleOf(user);
          try {
            localStorage.setItem('user_role', role);
            const n = user.user_metadata && user.user_metadata.fullname;
            if (n) localStorage.setItem('user_name', n);
          } catch (e) {}
          window.location.replace(this.homeFor(user));
          return true;
        }
      } catch (e) { console.warn('Session check failed:', e); }
      return false;
    }
  };

  // Keep the token fresh while the app is in use. Refreshing is done only by the
  // client itself (a second manual setSession() refresh raced it and invalidated the
  // refresh token, which signed people out).
  const resumeRefresh = () => { try { auth.startAutoRefresh(); } catch (e) {} };
  const pauseRefresh = () => { try { auth.stopAutoRefresh(); } catch (e) {} };
  document.addEventListener('visibilitychange', () => { document.hidden ? pauseRefresh() : resumeRefresh(); });
  window.addEventListener('online', resumeRefresh);

  // If the session really is gone (revoked / refresh token invalid), send them to log in
  // instead of leaving a half-broken page.
  const PUBLIC = ['', 'index.html', 'welcome.html', 'login.html', 'register.html', 'register-guide.html'];
  auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT') return;
    const page = window.location.pathname.split('/').pop();
    if (PUBLIC.includes(page)) return;
    window.location.replace('login.html');
  });
}

var _supabase = window._supabase;

// Handle Android Hardware Back Button natively across all pages
document.addEventListener('DOMContentLoaded', () => {
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', () => {
      const currentPage = window.location.pathname.split('/').pop() || 'home.html';

      if (currentPage === 'home.html' || currentPage === 'driver-dashboard.html' || currentPage === '') {
        if (typeof viewHistoryStack !== 'undefined' && viewHistoryStack.length > 1) {
          viewHistoryStack.pop();
          const previousView = viewHistoryStack[viewHistoryStack.length - 1];
          switchView(previousView, false);
          return;
        }

        if (window.confirm("Do you want to exit TriHatid?")) {
          window.Capacitor.Plugins.App.exitApp();
        }
      } else if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = 'home.html';
      }
    });
  }
});

// App resume (native): resume token refresh. We no longer call setSession() here.
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
  window.Capacitor.Plugins.App.addListener('appStateChange', ({ isActive }) => {
    try {
      if (isActive) _supabase.auth.startAutoRefresh();
      else _supabase.auth.stopAutoRefresh();
    } catch (e) {}
  });
}
