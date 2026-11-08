/* TaskFlow settings.

   CLOUD ACCOUNTS AND SYNC (Supabase)
   1. Create a free project at https://supabase.com
   2. Run supabase/schema.sql once in the SQL Editor.
   3. Project Settings > API: copy the Project URL and the "anon public" key below.
      (The anon key is meant to be public. NEVER paste the service_role key here.)

   Leave both empty and TaskFlow still works: accounts and data stay on this device only. */
window.TF_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
};
