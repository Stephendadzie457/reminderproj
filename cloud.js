/**
 * Thin wrapper around the Supabase client (window.TFCloud).
 *
 * `TFCloud.enabled` is false when js/config.js has no Supabase keys, in which case
 * the rest of the app falls back to device-only accounts. Nothing else in the app
 * talks to Supabase directly except js/sync.js and js/profile.js, and both go
 * through `TFCloud.client`.
 */
(function () {
  "use strict";

  const config = window.TF_CONFIG || {};
  const enabled = !!(
    config.supabaseUrl &&
    config.supabaseAnonKey &&
    window.supabase &&
    typeof window.supabase.createClient === "function"
  );

  /* Email links (confirm sign-up, reset password) arrive with "#...&type=recovery". supabase-js
     removes that hash as soon as it starts, so read it first. */
  const arrival =
    (/[#&?]type=(recovery|signup|invite|magiclink|email_change)/.exec(location.hash) || [])[1] || "";

  const client = enabled
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true, // lets confirmation and reset-password links sign people in
          storageKey: "tf-auth",
        },
      })
    : null;

  /** Turn Supabase's technical errors into sentences a person can act on. */
  function friendly(error) {
    const text = String((error && (error.message || error.error_description)) || error || "");
    const code = String((error && error.code) || "");
    if (/invalid login credentials/i.test(text)) return "That email or password is not right.";
    if (/email not confirmed/i.test(text))
      return "Please confirm your email first. Check your inbox for the link we sent.";
    if (/already registered|already been registered|user_already_exists/i.test(text + code))
      return "That email already has an account. Try signing in.";
    if (/rate limit|over_email_send_rate_limit|too many/i.test(text + code))
      return "Too many emails were sent. Please wait a few minutes and try again.";
    if (/password should be|weak_password/i.test(text + code))
      return "That password is too weak. Use at least 8 characters with letters and numbers.";
    if (/failed to fetch|network|load failed/i.test(text))
      return "Can't reach the server. Check your connection and try again.";
    if (/signups? (not allowed|are disabled)/i.test(text)) return "Sign-ups are turned off for this app.";
    return text || "Something went wrong. Please try again.";
  }

  /** The page the Supabase emails should send people back to (must be an allowed redirect URL). */
  const loginUrl = () => new URL("login.html", location.href).href;

  async function getSession() {
    if (!enabled) return null;
    const { data } = await client.auth.getSession();
    return data.session || null;
  }

  window.TFCloud = Object.freeze({
    enabled,
    client,
    arrival,
    friendly,
    getSession,
    loginUrl,
    onAuth: (callback) => (enabled ? client.auth.onAuthStateChange(callback) : null),
  });
})();
