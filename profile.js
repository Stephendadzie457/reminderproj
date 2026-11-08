/**
 * Profile and theme (window.TFProfile).
 *
 * A profile is { name, avatar, theme }: a display name, a small profile picture (a JPEG data
 * URL) and the accent colour of the app. It is cached on this device so it appears instantly,
 * and, for cloud accounts, kept in the Supabase `profiles` table so it follows the person
 * to every device.
 *
 * This file is loaded in the <head> so the saved accent colour is applied before the first paint.
 */
(function () {
  "use strict";

  const DEFAULT_THEME = "#F97316";
  const PRESETS = Object.freeze([
    ["Orange", "#F97316"],
    ["Blue", "#2563EB"],
    ["Violet", "#7C3AED"],
    ["Pink", "#DB2777"],
    ["Green", "#16A34A"],
    ["Teal", "#0D9488"],
    ["Red", "#DC2626"],
    ["Slate", "#475569"],
  ]);
  const HEX = /^#[0-9a-f]{6}$/i;
  const AVATAR_SIZE = 256;
  const AVATAR_MAX_CHARS = 70000; // keeps the picture around 50 KB
  const THEME_VARS = ["--ac", "--ac2", "--acs", "--acb", "--acd", "--on-ac"];
  const cloud = window.TFCloud && window.TFCloud.enabled ? window.TFCloud : null;
  const cacheKey = (email) => "tf_profile_" + email;
  let pushTimer = 0;

  /* ---------- colour maths ---------- */

  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l * 100];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s * 100, l * 100];
  }
  const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;

  /** Relative luminance, 0 (black) to 1 (white): decides whether text on the accent is dark or light. */
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  }

  /** All the shades the interface needs, derived from the one colour the person picks. */
  function shades(hex) {
    const [h, s, l] = hexToHsl(hex);
    return {
      "--ac": hex,
      "--ac2": hsl(h, s, Math.max(l - 8, 10)), // hover and pressed
      "--acs": hsl(h, Math.min(s, 100), 96), // soft background tint
      "--acb": hsl(h, Math.min(s, 100), 86), // tinted border
      "--acd": hsl(h, s, 28), // dark text on a tint
      "--on-ac": luminance(hex) > 0.5 ? "#16140f" : "#ffffff",
    };
  }

  const isHex = (value) => HEX.test(String(value || ""));
  const isDefault = (hex) => !isHex(hex) || hex.toUpperCase() === DEFAULT_THEME;

  /** Recolour the whole app. The default orange removes every override, so it looks exactly as designed. */
  function applyTheme(hex) {
    const style = document.documentElement.style;
    if (isDefault(hex)) THEME_VARS.forEach((v) => style.removeProperty(v));
    else Object.entries(shades(hex)).forEach(([k, v]) => style.setProperty(k, v));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", isDefault(hex) ? DEFAULT_THEME : hex);
    document.dispatchEvent(new CustomEvent("tf-theme"));
  }

  /* ---------- the cached profile ---------- */

  function get(email) {
    try {
      return JSON.parse(localStorage.getItem(cacheKey(email)) || "{}") || {};
    } catch (error) {
      return {};
    }
  }

  function put(email, profile) {
    try {
      localStorage.setItem(cacheKey(email), JSON.stringify(profile));
    } catch (error) {
      return false; // storage full
    }
    return true;
  }

  /**
   * Save a change to the profile on this device and (for cloud accounts) queue it for upload.
   * @param {string} email
   * @param {{ name?: string, avatar?: string, theme?: string }} patch
   * @param {string} [uid] the Supabase user id, when signed in to the cloud
   * @returns {boolean} false when the device had no room to store it
   */
  function set(email, patch, uid) {
    const next = { ...get(email), ...patch, dirty: true, up: Date.now() };
    if (!put(email, next)) return false;
    if ("theme" in patch) applyTheme(next.theme);
    if (cloud && uid) {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => push(email, uid).catch(() => {}), 800);
    }
    return true;
  }

  function clear(email) {
    localStorage.removeItem(cacheKey(email));
  }

  /* ---------- cloud copy ---------- */

  async function push(email, uid, fallbackName) {
    const p = get(email);
    const res = await cloud.client
      .from("profiles")
      .upsert(
        { id: uid, display_name: p.name || fallbackName || null, avatar: p.avatar || null, theme: p.theme || null },
        { onConflict: "id" },
      )
      .select("updated_at");
    if (res.error) throw new Error(res.error.message);
    put(email, { ...get(email), dirty: false, stamp: res.data[0] && res.data[0].updated_at });
  }

  /** Bring this device and the cloud into agreement. Returns the resulting profile. */
  async function sync(email, uid, fallbackName) {
    if (!cloud) return get(email);
    const res = await cloud.client
      .from("profiles")
      .select("display_name,avatar,theme,updated_at")
      .eq("id", uid);
    if (res.error) throw new Error(res.error.message);
    const remote = res.data[0];
    const local = get(email);
    if (!remote) {
      await push(email, uid, fallbackName);
    } else if (local.dirty) {
      await push(email, uid, fallbackName); // our unsent edit wins
    } else if (remote.updated_at !== local.stamp) {
      put(email, {
        name: remote.display_name || local.name,
        avatar: remote.avatar || "",
        theme: remote.theme || "",
        dirty: false,
        stamp: remote.updated_at,
        up: Date.now(),
      });
      applyTheme(remote.theme);
    }
    return get(email);
  }

  /* ---------- profile picture ---------- */

  /**
   * Turn a photo into a small square JPEG data URL (centre-cropped).
   * @param {File} file
   * @returns {Promise<string>}
   */
  async function avatarFromFile(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error("Please choose an image file.");
    if (file.size > 12 * 1024 * 1024) throw new Error("That image is too large. Choose one under 12 MB.");
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("That image could not be read."));
        el.src = url;
      });
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = AVATAR_SIZE;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
      ctx.drawImage(
        img,
        (img.naturalWidth - side) / 2,
        (img.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        AVATAR_SIZE,
        AVATAR_SIZE,
      );
      for (let quality = 0.86; quality >= 0.4; quality -= 0.1) {
        const data = canvas.toDataURL("image/jpeg", quality);
        if (data.length <= AVATAR_MAX_CHARS) return data;
      }
      return canvas.toDataURL("image/jpeg", 0.4);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---------- apply the saved colour and dark mode before the first paint ---------- */
  if (localStorage.getItem("tf_dark") === "1") document.documentElement.classList.add("dark");

  try {
    const session = JSON.parse(localStorage.getItem("tf_user") || "null");
    if (session && session.email) applyTheme(get(session.email).theme);
  } catch (error) {
    /* no saved session or profile: the default theme stays */
  }

  if (localStorage.getItem("tf_dark") === "1") document.documentElement.classList.add("dark");
  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("dkbtn");
    if (button)
      button.onclick = () => {
        const on = document.documentElement.classList.toggle("dark");
        localStorage.setItem("tf_dark", on ? "1" : "0");
      };
  });

  window.TFProfile = Object.freeze({
    DEFAULT_THEME,
    PRESETS,
    isHex,
    isDefault,
    get,
    set,
    clear,
    sync,
    push,
    applyTheme,
    avatarFromFile,
  });
})();
