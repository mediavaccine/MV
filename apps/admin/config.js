// Same project and same publishable key as the kiosk. The difference is not the
// key, it is the session: every request here carries a Supabase Auth token, and
// the RLS policies only open up for a user on the admin allow-list.
window.ADMIN_CONFIG = {
  supabaseUrl: 'https://kcxrnuyackbdnmjjisfa.supabase.co',
  supabaseKey: 'sb_publishable_aBSnQaGyGP33Dy0PpTFJEg_Bh4PPETj',
  kioskBaseUrl: 'https://kiosk.mediavaccine.com',
  logoBucket: 'event-logos',
};
