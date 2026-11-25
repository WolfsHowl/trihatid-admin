const SUPABASE_URL = "https://ynwsauldwhfmlbnrhfhl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JHg6iSCw9h9DlRzp463zxg__3tEzREv";

window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: window.sessionStorage,
    autoRefreshToken: true,
    persistSession: true
  }
});