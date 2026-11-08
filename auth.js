/**
 * TaskFlow accounts (window.TFAuth).
 *
 * Two modes, chosen automatically:
 *   "cloud"  js/config.js has Supabase keys. Accounts live in Supabase, and the
 *            data syncs across every device the person signs in on.
 *   "local"  No keys. Accounts live in this browser only (localStorage), with the
 *            seed accounts from data/users.json. Passwords are never stored in
 *            clear text: only a salted PBKDF2-SHA256 hash.
 *
 * The sign-in page only ever calls this file, so it does not care which mode runs.
 *
 * @typedef {{ ok: true, confirm?: boolean } | { ok: false, error: string, field?: string }} Result
 */
(function () {
  "use strict";

  const KEYS = Object.freeze({
    users: "tf_users", // local mode: every account created on this device
    session: "tf_user", // who is signed in right now
    tab: "tf_sess", // sessionStorage marker for "do not remember me"
    lock: "tf_lock", // failed-attempt counter
    lastEmail: "tf_last_email", // remembered email for the sign-in box
  });
  const PBKDF2_ROUNDS = 150000;
  const MIN_PASSWORD = 8;
  const MAX_ATTEMPTS = 5;
  const LOCK_MS = 30 * 1000;
  const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const encoder = new TextEncoder();
  const cloud = window.TFCloud && window.TFCloud.enabled ? window.TFCloud : null;
  const mode = cloud ? "cloud" : "local";

  /* ---------- small helpers ---------- */

  /** @returns {Result} a failed result, optionally pointing at the field to highlight */
  const fail = (error, field) => ({ ok: false, error, field });
  const normaliseEmail = (value) => String(value || "").trim().toLowerCase();
  const toBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  const toHex = (buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  /** Parse a JSON value from localStorage without ever throwing. */
  function readJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  /** Compare two strings without bailing out at the first difference. */
  function sameText(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /** Password strength from 0 (empty) to 4 (strong). */
  function passwordScore(password) {
    if (!password) return 0;
    let score = 0;
    if (password.length >= MIN_PASSWORD) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password) || password.length >= 12) score++;
    return Math.max(1, score);
  }

  /* ---------- sessions (shared by both modes) ---------- */

  /**
   * @param {{ name: string, email: string, id?: string, provider?: string }} user
   * @param {boolean} remember keep the session after the browser closes
   */
  function startSession(user, remember) {
    const keep = remember !== false;
    localStorage.setItem(
      KEYS.session,
      JSON.stringify({
        name: user.name,
        email: user.email,
        id: user.id || "",
        provider: user.provider || "password",
        remember: keep,
      }),
    );
    if (keep) sessionStorage.removeItem(KEYS.tab);
    else sessionStorage.setItem(KEYS.tab, "1");
    if (keep) localStorage.setItem(KEYS.lastEmail, user.email);
    else localStorage.removeItem(KEYS.lastEmail);
  }

  /** The signed-in person, or null. Sessions started without "remember me" end with the tab. */
  function currentSession() {
    const session = readJSON(KEYS.session, null);
    if (!session) return null;
    if (session.remember === false && !sessionStorage.getItem(KEYS.tab)) {
      localStorage.removeItem(KEYS.session);
      if (cloud) cloud.client.auth.signOut({ scope: "local" });
      return null;
    }
    return session;
  }

  /** Cloud mode: turn the Supabase session (for example after an email link) into a TaskFlow one. */
  async function adoptCloudSession(remember) {
    if (!cloud) return false;
    const session = await cloud.getSession();
    if (!session) return false;
    const user = session.user;
    const meta = user.user_metadata || {};
    startSession(
      {
        name: meta.name || user.email.split("@")[0],
        email: normaliseEmail(user.email),
        id: user.id,
        provider: "cloud",
      },
      remember,
    );
    return true;
  }

  /* ---------- failed-attempt lockout (this device only) ---------- */

  function lockSecondsLeft() {
    const state = readJSON(KEYS.lock, { count: 0, until: 0 });
    return Math.max(0, Math.ceil((state.until - Date.now()) / 1000));
  }
  function recordFailure() {
    const state = readJSON(KEYS.lock, { count: 0, until: 0 });
    state.count += 1;
    if (state.count >= MAX_ATTEMPTS) {
      state.count = 0;
      state.until = Date.now() + LOCK_MS;
    }
    localStorage.setItem(KEYS.lock, JSON.stringify(state));
  }
  const clearFailures = () => localStorage.removeItem(KEYS.lock);

  /* ---------- input checks shared by both modes ---------- */

  /** @returns {Result | null} the first problem with a sign-up form, or null when it is fine */
  function checkSignUp({ name, email, password, agree }) {
    if (!String(name || "").trim()) return fail("Enter your name.", "name");
    if (!EMAIL_RX.test(normaliseEmail(email))) return fail("Enter a valid email address.", "email");
    if (String(password || "").length < MIN_PASSWORD)
      return fail(`Use at least ${MIN_PASSWORD} characters for your password.`, "password");
    if (agree === false) return fail("Please accept the privacy notice to continue.", "agree");
    return null;
  }

  /* ======================================================================
     CLOUD MODE (Supabase)
     ====================================================================== */

  async function cloudSignUp(form) {
    const email = normaliseEmail(form.email);
    const name = form.name.trim();
    const { data, error } = await cloud.client.auth.signUp({
      email,
      password: form.password,
      options: { data: { name }, emailRedirectTo: cloud.loginUrl() },
    });
    if (error)
      return fail(cloud.friendly(error), /registered|exists/i.test(error.message) ? "email" : undefined);
    // Supabase hides whether an address already exists: an empty identities list means it does.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
      return fail("That email already has an account. Try signing in.", "email");
    if (!data.session) return { ok: true, confirm: true }; // "Confirm email" is on in Supabase
    startSession({ name, email, id: data.user.id, provider: "cloud" }, true);
    return { ok: true };
  }

  async function cloudSignIn(form) {
    const email = normaliseEmail(form.email);
    const { data, error } = await cloud.client.auth.signInWithPassword({
      email,
      password: form.password,
    });
    if (error) {
      const wrong = /invalid login/i.test(error.message);
      if (wrong) recordFailure();
      return fail(cloud.friendly(error), wrong ? "password" : undefined);
    }
    clearFailures();
    const meta = data.user.user_metadata || {};
    startSession(
      { name: meta.name || email.split("@")[0], email, id: data.user.id, provider: "cloud" },
      form.remember,
    );
    return { ok: true };
  }

  /* ======================================================================
     LOCAL MODE (this browser only)
     ====================================================================== */

  function localUsers() {
    const users = readJSON(KEYS.users, {});
    Object.values(users).forEach((u) => {
      if (u && !u.hash && u.pw) u.hash = "b64:" + u.pw; // the very first format
    });
    return users;
  }
  const saveUsers = (users) => localStorage.setItem(KEYS.users, JSON.stringify(users));

  /** Seed accounts shipped with the site. Falls back to the cache when offline. */
  async function seedUsers() {
    const out = {};
    const add = (json) =>
      (json.users || []).forEach((u) => {
        out[normaliseEmail(u.email)] = u;
      });
    try {
      add(await (await fetch("data/users.json", { cache: "no-store" })).json());
    } catch (error) {
      try {
        const cached = await caches.match("data/users.json");
        if (cached) add(await cached.json());
      } catch (offline) {
        /* nothing cached yet: only locally created accounts are available */
      }
    }
    return out;
  }

  async function derive(password, salt, rounds) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
      "deriveBits",
    ]);
    return crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds },
      key,
      256,
    );
  }

  async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const bits = await derive(password, salt, PBKDF2_ROUNDS);
    return `pbkdf2$${PBKDF2_ROUNDS}$${toBase64(salt)}$${toBase64(bits)}`;
  }

  /** @returns {Promise<{ ok: boolean, legacy?: boolean }>} legacy = matched an old format */
  async function checkPassword(password, stored) {
    if (!stored) return { ok: false };
    if (stored.startsWith("pbkdf2$")) {
      const [, rounds, salt, expected] = stored.split("$");
      const bits = await derive(password, fromBase64(salt), Number(rounds));
      return { ok: sameText(toBase64(bits), expected) };
    }
    if (stored.startsWith("b64:")) {
      const encoded = "b64:" + btoa(unescape(encodeURIComponent(password)));
      return { ok: sameText(stored, encoded), legacy: true };
    }
    const sha = toHex(await crypto.subtle.digest("SHA-256", encoder.encode(password)));
    return { ok: sameText(sha, stored), legacy: true };
  }

  async function localSignUp(form) {
    const email = normaliseEmail(form.email);
    const taken = { ...(await seedUsers()), ...localUsers() };
    if (taken[email]) return fail("That email already has an account. Try signing in.", "email");
    const users = localUsers();
    users[email] = {
      name: form.name.trim(),
      email,
      hash: await hashPassword(form.password),
      provider: "password",
    };
    saveUsers(users);
    startSession(users[email], true);
    return { ok: true };
  }

  async function localSignIn(form) {
    const email = normaliseEmail(form.email);
    const users = localUsers();
    const account = users[email] || (await seedUsers())[email];
    if (!account) return fail("No account found for that email. Create one first.", "email");
    if (!account.hash) return fail("This account has no password. Create a new account instead.");

    const check = await checkPassword(form.password, account.hash);
    if (!check.ok) {
      recordFailure();
      return fail("That password is not right. Please try again.", "password");
    }
    clearFailures();
    if (check.legacy && users[email]) {
      users[email].hash = await hashPassword(form.password); // upgrade an old hash
      saveUsers(users);
    }
    startSession(account, form.remember);
    return { ok: true };
  }

  /* ======================================================================
     PUBLIC API
     ====================================================================== */

  /** @returns {Promise<Result>} */
  async function signUp(form) {
    const problem = checkSignUp(form);
    if (problem) return problem;
    try {
      return cloud ? await cloudSignUp(form) : await localSignUp(form);
    } catch (error) {
      return fail(cloud ? cloud.friendly(error) : "Something went wrong. Please try again.");
    }
  }

  /** @returns {Promise<Result>} */
  async function signIn(form) {
    const wait = lockSecondsLeft();
    if (wait) return fail(`Too many attempts. Try again in ${wait}s.`);
    if (!EMAIL_RX.test(normaliseEmail(form.email)))
      return fail("Enter a valid email address.", "email");
    if (!form.password) return fail("Enter your password.", "password");
    try {
      return cloud ? await cloudSignIn(form) : await localSignIn(form);
    } catch (error) {
      return fail(cloud ? cloud.friendly(error) : "Something went wrong. Please try again.");
    }
  }

  /** Email a password-reset link. Cloud mode only. @returns {Promise<Result>} */
  async function resetPassword(email) {
    if (!cloud)
      return fail("Password reset needs cloud accounts, which are not set up on this site yet.");
    if (!EMAIL_RX.test(normaliseEmail(email))) return fail("Enter a valid email address.", "email");
    const { error } = await cloud.client.auth.resetPasswordForEmail(normaliseEmail(email), {
      redirectTo: cloud.loginUrl() + "?mode=reset",
    });
    return error ? fail(cloud.friendly(error)) : { ok: true };
  }

  /** Set a new password for the signed-in (or just-recovered) person. @returns {Promise<Result>} */
  async function updatePassword(password) {
    if (!cloud) return fail("Changing the password needs a cloud account.");
    if (String(password || "").length < MIN_PASSWORD)
      return fail(`Use at least ${MIN_PASSWORD} characters for your password.`, "password");
    const { error } = await cloud.client.auth.updateUser({ password });
    return error ? fail(cloud.friendly(error), "password") : { ok: true };
  }

  /** Forget the session on this device (and in Supabase). Data cleanup is up to the caller. */
  async function signOut() {
    localStorage.removeItem(KEYS.session);
    sessionStorage.removeItem(KEYS.tab);
    if (cloud) {
      try {
        await cloud.client.auth.signOut();
      } catch (error) {
        /* offline: the local session is already gone */
      }
    }
  }

  window.TFAuth = Object.freeze({
    mode,
    isSignedIn: () => !!currentSession(),
    session: currentSession,
    lastEmail: () => localStorage.getItem(KEYS.lastEmail) || "",
    minPassword: MIN_PASSWORD,
    passwordScore,
    signUp,
    signIn,
    resetPassword,
    updatePassword,
    signOut,
    adoptCloudSession,
    /** Cloud mode: run `callback` when someone arrives from a password-reset email. */
    onRecovery(callback) {
      if (!cloud) return;
      cloud.onAuth((event) => {
        if (event === "PASSWORD_RECOVERY") callback();
      });
    },
  });
})();
