// Connection details for the kiosk.
//
// The publishable key is meant to be public — it identifies the project, it does
// not authorise anything. Everything this key can reach is decided by the
// database: the anon role holds no privileges on any table and can execute
// exactly two functions (see supabase/migrations). Never put a service_role key
// here; that one does bypass row level security.
window.KIOSK_CONFIG = {
  supabaseUrl: 'https://kcxrnuyackbdnmjjisfa.supabase.co',
  supabaseKey: 'sb_publishable_aBSnQaGyGP33Dy0PpTFJEg_Bh4PPETj',

  // Milliseconds of no interaction before the screen returns to search.
  idleResetMs: 30000,
  // How long a cached guest list stays usable when the network is unreachable.
  cacheMaxAgeMs: 24 * 60 * 60 * 1000,
};
