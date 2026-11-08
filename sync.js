/**
 * Cloud sync (window.TFSync).
 *
 * The app always works from the copy of the data on this device, so it stays fast and
 * works offline. This file quietly keeps that copy and Supabase in step:
 *
 *   - Tasks, notes, history, settings and timer sessions live in ONE row (user_data).
 *   - Each whiteboard lives in its own row (boards), because drawings can be large.
 *   - Changes from two devices are combined with a three-way merge against the last state
 *     this device synced ("base"), so edits, additions and deletions made on different
 *     phones are all kept instead of one phone overwriting the other.
 *   - Supabase Realtime tells open devices to sync within a second or two.
 *
 * The app calls `start()` once after sign-in, `touch()` after every save, and `flush()`
 * before signing out.
 */
(function () {
  "use strict";

  const cloud = window.TFCloud && window.TFCloud.enabled ? window.TFCloud : null;
  const PUSH_DELAY_MS = 1500; // wait for a burst of edits to finish
  const POLL_MS = 60 * 1000; // safety net in case Realtime is blocked
  const RETRY_MS = 30 * 1000;
  const MAX_LOG = 400;
  const NOT_SYNCED = new Set(["boards", "board", "events"]); // boards sync separately; the rest is legacy

  const status = { state: cloud ? "idle" : "off", at: 0, error: "" };
  const listeners = new Set();
  let ctx = null; // { uid, getData, apply }
  let base = null; // what this device last agreed on with the cloud
  let pushTimer = 0;
  let pollTimer = 0;
  let retryTimer = 0;
  let channel = null;
  let running = false;
  let again = false;
  let dirty = false;
  const seen = new Map(); // item key -> fingerprint, used to stamp `up` on edited items

  /* ---------- status ---------- */

  function setStatus(state, error) {
    status.state = state;
    status.error = error || "";
    if (state === "synced") status.at = Date.now();
    listeners.forEach((fn) => {
      try {
        fn({ ...status });
      } catch (e) {
        /* a broken listener must not stop syncing */
      }
    });
  }

  /* ---------- comparing and merging ---------- */

  /** JSON with sorted keys, so two copies of the same data always compare equal. */
  function canon(value) {
    if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
    if (value && typeof value === "object") {
      return (
        "{" +
        Object.keys(value)
          .sort()
          .filter((k) => value[k] !== undefined)
          .map((k) => JSON.stringify(k) + ":" + canon(value[k]))
          .join(",") +
        "}"
      );
    }
    return JSON.stringify(value);
  }
  const same = (a, b) => canon(a) === canon(b);
  const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  /** A stable key for an item in a list: its id, or the id of the thing it wraps (trash), or its content. */
  function keyOf(item) {
    if (item && typeof item === "object") {
      if (item.id != null) return "i:" + item.id;
      if (item.item && item.item.id != null) return "t:" + item.k + ":" + item.item.id;
      return "j:" + canon(item);
    }
    return "p:" + String(item);
  }

  /** Newest first for lists made with unshift(); oldest first for timer sessions. */
  function orderList(name, items) {
    if (!items.length || !items.every((x) => x && typeof x === "object")) return items;
    if (items.every((x) => typeof x.id === "string"))
      return items.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    if (items.every((x) => typeof x.at === "number"))
      return items.sort((a, b) => (name === "focus" ? a.at - b.at : b.at - a.at));
    return items;
  }

  /**
   * Three-way merge of one list. `b` is the last agreed list, `l` is ours, `r` is the cloud's.
   * Whoever changed an item wins; if both changed it, the newer `up` wins; a deletion never
   * beats an edit made on the other device.
   */
  function mergeList(name, b, l, r) {
    const index = (list) => new Map((list || []).map((x) => [keyOf(x), x]));
    const B = index(b),
      L = index(l),
      R = index(r);
    const out = [];
    const order = [...new Set([...L.keys(), ...R.keys(), ...B.keys()])];
    for (const k of order) {
      const bi = B.get(k),
        li = L.get(k),
        ri = R.get(k);
      const localChanged = !same(li, bi),
        remoteChanged = !same(ri, bi);
      let pick;
      if (!localChanged) pick = ri;
      else if (!remoteChanged) pick = li;
      else if (li === undefined) pick = ri; // we deleted it, they edited it: keep the edit
      else if (ri === undefined) pick = li; // they deleted it, we edited it: keep the edit
      else pick = (li.up || 0) >= (ri.up || 0) ? li : ri;
      if (pick !== undefined) out.push(clone(pick));
    }
    const ordered = orderList(name, out);
    return name === "log" ? ordered.slice(0, MAX_LOG) : ordered;
  }

  /** Three-way merge of a single value or settings object. On a true conflict this device wins. */
  function mergeValue(b, l, r) {
    if (same(l, r)) return clone(l);
    if (same(l, b)) return clone(r);
    if (same(r, b)) return clone(l);
    if (isObject(l) && isObject(r)) {
      const out = {};
      const bb = isObject(b) ? b : {};
      for (const k of new Set([...Object.keys(bb), ...Object.keys(l), ...Object.keys(r)])) {
        const v = mergeValue(bb[k], l[k], r[k]);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    return clone(l);
  }

  function mergeDoc(b, l, r) {
    const out = {};
    const bb = b || {};
    for (const key of new Set([...Object.keys(bb), ...Object.keys(l), ...Object.keys(r)])) {
      const lists = [bb[key], l[key], r[key]].some(Array.isArray);
      const merged = lists
        ? mergeList(key, bb[key], l[key], r[key])
        : mergeValue(bb[key], l[key], r[key]);
      if (merged !== undefined) out[key] = merged;
    }
    return out;
  }

  /* ---------- reading and writing the local copy ---------- */

  function split(data) {
    const doc = {};
    Object.keys(data).forEach((k) => {
      if (!NOT_SYNCED.has(k)) doc[k] = data[k];
    });
    return { doc, boards: Array.isArray(data.boards) ? data.boards : [] };
  }

  /** Give every edited item a fresh `up` stamp, so a later merge knows which copy is newer. */
  function stamp(data) {
    const { doc } = split(data);
    Object.keys(doc).forEach((name) => {
      if (!Array.isArray(doc[name])) return;
      doc[name].forEach((item) => {
        if (!item || typeof item !== "object") return;
        const { up, ...rest } = item;
        const key = name + "|" + keyOf(item);
        const print = canon(rest);
        if (seen.has(key) && seen.get(key) !== print) item.up = Date.now();
        seen.set(key, print);
      });
    });
  }

  function loadBase(uid) {
    try {
      return JSON.parse(localStorage.getItem("tf_sync_" + uid) || "null");
    } catch (e) {
      return null;
    }
  }
  const saveBase = () => {
    try {
      localStorage.setItem("tf_sync_" + ctx.uid, JSON.stringify(base));
    } catch (e) {
      /* storage full: the next sync simply starts from an empty base and merges again */
    }
  };

  const hash = (value) => {
    const text = canon(value);
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return String(h) + ":" + text.length;
  };

  /* ---------- one round of syncing ---------- */

  function must(result) {
    if (result.error) {
      const error = new Error(result.error.message || "Sync failed");
      error.code = result.error.code;
      throw error;
    }
    return result.data;
  }

  async function syncDoc() {
    const db = cloud.client;
    const uid = ctx.uid;
    for (let attempt = 0; attempt < 4; attempt++) {
      const local = clone(split(ctx.getData()).doc);
      const rows = must(await db.from("user_data").select("data,rev").eq("user_id", uid));
      const remote = rows[0] || null;

      if (!remote) {
        const inserted = await db.from("user_data").insert({ user_id: uid, data: local, rev: 1 });
        if (inserted.error && inserted.error.code === "23505") continue; // another device got there first
        must(inserted);
        base.doc = local;
        base.rev = 1;
        return;
      }

      const merged = mergeDoc(base.doc || {}, local, remote.data || {});
      let rev = remote.rev;
      if (!same(merged, remote.data)) {
        const updated = must(
          await db
            .from("user_data")
            .update({ data: merged, rev: remote.rev + 1 })
            .eq("user_id", uid)
            .eq("rev", remote.rev)
            .select("rev"),
        );
        if (!updated.length) continue; // somebody wrote in between: merge again
        rev = remote.rev + 1;
      }
      base.doc = clone(merged); // a private copy: the app edits its own lists in place
      base.rev = rev;

      // The person may have kept editing while we were talking to the server.
      const now = clone(split(ctx.getData()).doc);
      const final = same(now, local) ? merged : mergeDoc(local, now, merged);
      if (!same(final, now)) ctx.apply({ doc: clone(final) });
      if (!same(final, merged)) again = true; // our newest edits still need to go up
      return;
    }
    throw new Error("Could not settle a conflict. Will retry.");
  }

  async function syncBoards() {
    const db = cloud.client;
    const uid = ctx.uid;
    const rows = must(
      await db.from("boards").select("id,data,deleted,updated_at").eq("user_id", uid),
    );
    const remote = new Map(rows.map((r) => [r.id, r]));
    const local = new Map(split(ctx.getData()).boards.map((b) => [b.id, clone(b)]));
    const old = base.boards || {};
    const next = {};
    const writes = [];
    const result = new Map(local);

    for (const id of new Set([...local.keys(), ...remote.keys(), ...Object.keys(old)])) {
      const L = local.get(id),
        R = remote.get(id),
        B = old[id];
      // A new device starts with an empty default board. Never upload it, and drop it
      // once the cloud turns out to have real boards, so nobody collects blank copies.
      if (L && !B && !R && !L.json && !L.img) {
        if ([...remote.values()].some((r) => !r.deleted)) result.delete(id);
        continue;
      }
      const localChanged = L ? !B || B.h !== hash(L) : !!B && !B.gone;
      const remoteChanged = !!R && (!B || B.ts !== R.updated_at);
      const takeRemote = () => {
        if (R.deleted) result.delete(id);
        else result.set(id, R.data);
        next[id] = { h: R.deleted ? "" : hash(R.data), ts: R.updated_at, gone: !!R.deleted };
      };
      const sendLocal = () => writes.push({ id, L });

      if (!localChanged && !remoteChanged) {
        if (B) next[id] = B;
      } else if (localChanged && !remoteChanged) sendLocal();
      else if (!localChanged && remoteChanged) takeRemote();
      else if (!L && R && !R.deleted) takeRemote(); // deleted here, edited there
      else if (L && R && R.deleted) sendLocal(); // deleted there, edited here
      else if (!L && R && R.deleted) next[id] = { h: "", ts: R.updated_at, gone: true };
      else if (L && R) ((L.up || 0) >= ((R.data && R.data.up) || 0) ? sendLocal : takeRemote)();
    }

    if (writes.length) {
      const saved = must(
        await db
          .from("boards")
          .upsert(
            writes.map((w) => ({ user_id: uid, id: w.id, data: w.L || {}, deleted: !w.L })),
            { onConflict: "user_id,id" },
          )
          .select("id,updated_at"),
      );
      const stamps = new Map(saved.map((s) => [s.id, s.updated_at]));
      writes.forEach((w) => {
        next[w.id] = { h: w.L ? hash(w.L) : "", ts: stamps.get(w.id) || "", gone: !w.L };
      });
    }
    base.boards = next;

    const merged = [...result.values()].sort((a, b) => (a.id < b.id ? 1 : -1));
    if (!same(merged, split(ctx.getData()).boards)) ctx.apply({ boards: clone(merged) });
  }

  async function syncOnce() {
    if (!cloud || !ctx) return;
    if (running) {
      again = true;
      return;
    }
    if (!navigator.onLine) return setStatus("offline");
    running = true;
    dirty = false;
    setStatus("syncing");
    try {
      stamp(ctx.getData());
      base = base || { doc: null, rev: 0, boards: {} };
      await syncDoc();
      await syncBoards();
      saveBase();
      setStatus("synced");
    } catch (error) {
      const offline =
        !navigator.onLine || /failed to fetch|network|load failed/i.test(String(error.message));
      setStatus(offline ? "offline" : "error", offline ? "" : error.message);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(queue, RETRY_MS);
    } finally {
      running = false;
      if (again || dirty) {
        again = false;
        queue();
      }
    }
  }

  /** Schedule a sync soon. Repeated calls inside the delay collapse into one. */
  function queue(delay) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncOnce, delay == null ? PUSH_DELAY_MS : delay);
  }

  /* ---------- public API ---------- */

  const onVisible = () => {
    if (!document.hidden) queue(300);
  };
  const onOnline = () => queue(300);
  const onOffline = () => setStatus("offline");

  function listen() {
    try {
      channel = cloud.client
        .channel("tf-" + ctx.uid)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_data", filter: "user_id=eq." + ctx.uid },
          () => queue(400),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "boards", filter: "user_id=eq." + ctx.uid },
          () => queue(400),
        )
        .subscribe();
    } catch (error) {
      /* Realtime unavailable: the polling timer still keeps things fresh */
    }
  }

  /**
   * @param {{ uid: string, getData: () => object, apply: (change: { doc?: object, boards?: object[] }) => void }} options
   */
  function start(options) {
    if (!cloud) return;
    stop();
    ctx = options;
    base = loadBase(ctx.uid);
    stamp(ctx.getData());
    document.addEventListener("visibilitychange", onVisible);
    addEventListener("online", onOnline);
    addEventListener("offline", onOffline);
    pollTimer = setInterval(() => !document.hidden && queue(0), POLL_MS);
    listen();
    queue(0);
  }

  function stop() {
    clearTimeout(pushTimer);
    clearTimeout(retryTimer);
    clearInterval(pollTimer);
    document.removeEventListener("visibilitychange", onVisible);
    removeEventListener("online", onOnline);
    removeEventListener("offline", onOffline);
    if (channel) {
      try {
        cloud.client.removeChannel(channel);
      } catch (e) {
        /* already closed */
      }
      channel = null;
    }
    ctx = null;
  }

  /** The app calls this after every local save. */
  function touch() {
    if (!cloud || !ctx) return;
    dirty = true;
    stamp(ctx.getData());
    queue();
  }

  /** Push everything now (used before signing out). Resolves with whether the cloud is up to date. */
  async function flush() {
    if (!cloud || !ctx) return { ok: true };
    clearTimeout(pushTimer);
    for (let i = 0; i < 20 && running; i++) await new Promise((r) => setTimeout(r, 150));
    await syncOnce();
    return { ok: status.state === "synced", error: status.error };
  }

  /** Remove the sync bookkeeping for one account from this device. */
  function forget(uid) {
    localStorage.removeItem("tf_sync_" + uid);
  }

  window.TFSync = Object.freeze({
    enabled: !!cloud,
    start,
    stop,
    touch,
    flush,
    forget,
    syncNow: () => queue(0),
    status: () => ({ ...status }),
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /* exposed so the merge rules can be tested on their own */
    _internals: { mergeDoc, mergeList, canon },
  });
})();
