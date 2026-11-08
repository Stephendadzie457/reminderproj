(() => {
  const $ = (id) => document.getElementById(id),
    esc = (s) =>
      String(s).replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
      ),
    pad = (n) => String(n).padStart(2, "0");
  const key = (d) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    today = () => key(new Date());
  let user = JSON.parse(localStorage.getItem("tf_user") || "null");
  // A session started without "remember me" ends with the browser tab.
  if (user && user.remember === false && !sessionStorage.getItem("tf_sess")) {
    localStorage.removeItem("tf_user");
    user = null;
  }
  const guest = new URLSearchParams(location.search).has("guest");
  if (!user) {
    if (guest) user = { name: "Guest", email: "guest" };
    else {
      location.replace("login.html");
      return;
    }
  }
  const DK = "tf_data_" + user.email;
  let D = Object.assign(
    {
      tasks: [],
      notes: [],
      events: [],
      board: "",
      timer: { mode: 25 },
      log: [],
      trash: [],
    },
    JSON.parse(localStorage.getItem(DK) || "{}"),
  );
  const save = () => {
    try {
      localStorage.setItem(DK, JSON.stringify(D));
    } catch (e) {
      toast("Storage is full. Clear some data.");
    }
    renderNav();
    syncSoon();
    if (window.TFSync) TFSync.touch();
  };
  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const log = (k, t) => {
    D.log.unshift({ id: uid(), k, t, at: Date.now() });
    if (D.log.length > 400) D.log.length = 400;
  };
  const dshort = (ts) =>
      new Date(ts).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      }),
    tshort = (ts) =>
      new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
  function toast(m) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = m;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  function dlFile(content, name, type) {
    const b = new Blob([content], {
        type: type || "text/plain;charset=utf-8",
      }),
      a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  /* Render a standalone document in a hidden iframe and open the print
     dialog (choose "Save as PDF"). No library needed. */
  function printDoc(html) {
    const fr = document.createElement("iframe");
    fr.setAttribute("aria-hidden", "true");
    fr.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(fr);
    fr.contentDocument.open();
    fr.contentDocument.write(html);
    fr.contentDocument.close();
    setTimeout(() => {
      try {
        fr.contentWindow.focus();
        fr.contentWindow.print();
      } catch (e) {
        toast("Could not open the print dialog. Try Export instead.");
      }
      setTimeout(() => fr.remove(), 60000);
    }, 250);
  }
  /* Safe filename from any title */
  const slug = (s, fb) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fb || "file";
  const ICN = {
    home: "house",
    check: "circle-check",
    note: "file-text",
    cal: "calendar",
    pen: "pencil",
    timer: "timer",
    hist: "history",
    help: "circle-help",
    plus: "plus",
    x: "x",
    out: "log-out",
    down: "download",
    menu: "menu",
    l: "chevron-left",
    r: "chevron-right",
    more: "ellipsis",
    search: "search",
    flag: "flag",
    bell: "bell",
    set: "settings",
    trash: "trash-2",
    clock: "clock",
  };
  const ic = (n) => `<i data-lucide="${ICN[n] || n}" class="ico"></i>`;
  const isGuest = user.email === "guest";
  const useCloud = !isGuest && user.provider === "cloud" && TFCloud.enabled;
  let profile = isGuest ? {} : TFProfile.get(user.email);
  if (profile.name) user.name = profile.name;
  const avatarHTML = () =>
    profile.avatar
      ? `<img src="${esc(profile.avatar)}" alt="">`
      : esc((user.name[0] || "?").toUpperCase());
  /** Show the current name and photo everywhere they appear. */
  function paintIdentity() {
    $("un").textContent = user.name;
    $("ue").textContent = isGuest ? "Guest session" : user.email;
    $("av").innerHTML = avatarHTML();
    const button = $("pbtn");
    button.hidden = isGuest;
    button.innerHTML = avatarHTML();
    button.setAttribute("aria-label", "Profile menu for " + user.name);
  }
  paintIdentity();
  $("out").title = isGuest ? "Exit guest" : "Log out";
  const TABS = [
    ["home", "home", "Home"],
    ["tasks", "check", "To-dos"],
    ["notes", "note", "Notes"],
    ["cal", "cal", "Calendar"],
    ["board", "pen", "Whiteboard"],
    ["timer", "timer", "Focus timer"],
    ["profile", "user", "Profile"],
    ["history", "hist", "History"],
    ["settings", "set", "Settings"],
    ["help", "help", "Help & privacy"],
  ];
  const GR = [
    ["Workspace", ["home", "tasks", "notes", "cal", "board"]],
    ["Focus", ["timer"]],
    ["More", ["history", "settings", "help"]],
  ];
  const SMART = [
    ["myday", "sun", "My Day"],
    ["priority", "flag", "Priority"],
    ["upcoming", "cal", "Upcoming"],
    ["all", "list", "Everything"],
  ];
  let curList = "myday";
  const inList = (t, id) =>
    id === "myday" ? t.my === today() : id === "priority" ? t.p === "high" : id === "upcoming" ? !!t.due : id === "all" ? true : t.list === id;
  const listLabel = (id) => {
    const sm = SMART.find((x) => x[0] === id);
    return sm ? sm[2] : (D.lists.find((l) => l.id === id) || { name: "List" }).name;
  };
  let cur = "home",
    cleanup = null;
  function renderNav() {
    const open = D.tasks.filter((t) => !t.done);
    const item = (attrs, on, icon, label, count) => `<button class="nv ${on ? "on" : ""}" ${attrs}>${icon}<span>${label}</span>${count ? `<em>${count}</em>` : ""}</button>`;
    const grp = (label, ids) => `<div class="gl">${label}</div>` + ids.map((id) => { const t = TABS.find((x) => x[0] === id); return item(`data-t="${id}"`, id === cur, ic(t[1]), t[2], 0); }).join("");
    $("nav").innerHTML =
      grp("Overview", ["home"]) + `<div class="gl">To-dos</div>` +
      SMART.map((x) => item(`data-t="tasks" data-l="${x[0]}"`, cur === "tasks" && curList === x[0], ic(x[1]), x[2], open.filter((t) => inList(t, x[0])).length)).join("") +
      `<div class="gl">Lists</div>` +
      D.lists.map((l) => item(`data-t="tasks" data-l="${l.id}"`, cur === "tasks" && curList === l.id, `<i class="ldot" style="background:${esc(l.color)}"></i>`, esc(l.name), open.filter((t) => t.list === l.id).length)).join("") +
      `<button class="nv mutb" id="newlist">${ic("plus")}<span>New list</span></button>` +
      grp("Workspace", ["cal", "notes", "board", "timer"]) + grp("More", ["history", "settings", "help"]);
  }
  const menu = (o) => {
    $("sb").classList.toggle("open", o);
    $("bd").classList.toggle("open", o);
  };
  $("mb").onclick = () => menu(true);
  $("bd").onclick = () => menu(false);
  $("sbx").onclick = () => menu(false);
  $("tbm").onclick = () => menu(true);
  const V = () => ({
    home,
    tasks,
    notes,
    cal,
    board,
    timer,
    history: histView,
    profile: profileView,
    help,
    settings,
  });
  function go(t) {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    killCh();
    cur = t;
    menu(false);
    history.replaceState(null, "", "#" + t);
    renderNav();
    document
      .querySelectorAll("#tabbar [data-t]")
      .forEach((b) => b.classList.toggle("on", b.dataset.t === t && (!b.dataset.l || b.dataset.l === curList)));
    $("tbm").classList.toggle(
      "on",
      !["home", "tasks", "notes", "cal"].includes(t),
    );
    $("tt").textContent = t === "tasks" ? listLabel(curList) : TABS.find((x) => x[0] === t)[2];
    $("v").innerHTML = "";
    $("v").scrollTop = 0;
    V()[t]();
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]");
    if (b && b.closest("#nav,#tabbar")) {
      if (b.dataset.l) curList = b.dataset.l;
      go(b.dataset.t);
    }
    if (e.target.closest("#newlist")) {
      menu(false);
      openList();
    }
  });
  $("qa").onclick = () => {
    menu(false);
    openTask();
  };
  let dp;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    dp = e;
    $("inst").hidden = false;
  });
  $("inst").onclick = async () => {
    if (!dp) return;
    dp.prompt();
    await dp.userChoice;
    dp = null;
    $("inst").hidden = true;
  };
  addEventListener("appinstalled", () => ($("inst").hidden = true));
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

  /* SHARED: priorities, dates, migration */
  const dj = window.dayjs;
  const PR = {
      low: { n: "Low", c: "#16a34a" },
      med: { n: "Medium", c: "#d97706" },
      high: { n: "High", c: "#dc2626" },
    },
    RK = { high: 0, med: 1, low: 2 };
  /* An emoji is the only thing a task may carry in its emoji slot. Anything else
     (typed text, markup from an imported file) is dropped, so it is safe to render. */
  const EMO_RX = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
  const cleanEmo = (v) => {
    v = String(v || "").trim();
    if (!v) return "";
    let g = v;
    try {
      g = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(v)][0].segment;
    } catch (e) {
      g = v.slice(0, 8);
    }
    return EMO_RX.test(g) ? g : "";
  };
  function migrate() {
    D.tasks = D.tasks || [];
    (D.events || []).forEach((e) =>
      D.tasks.push({
        id: e.id,
        text: e.title,
        desc: "",
        p: "med",
        done: false,
        due: e.date,
        time: e.time || "",
        rem: true,
        at: Date.now(),
      }),
    );
    D.events = [];
    D.tasks.forEach((t) => {
      t.desc = t.desc || "";
      t.due = t.due || "";
      t.time = t.time || "";
      t.emo = cleanEmo(t.emo);
      t.steps = Array.isArray(t.steps) ? t.steps : [];
      t.list = t.list || "";
      t.my = t.my || "";
      t.repeat = t.repeat || "";
      t.est = +t.est || 0;
      t.spent = +t.spent || 0;
      if (!PR[t.p]) t.p = "med";
      if (t.rem === undefined) t.rem = !!t.due;
    });
    D.lists = Array.isArray(D.lists) ? D.lists.filter((l) => l && l.id) : [];
    D.focus = D.focus || [];
    D.timer = Object.assign({ mode: 25, kind: "focus", range: "7d" }, D.timer || {});
    D.log = D.log || [];
    D.trash = D.trash || [];
    /* one canvas image used to be the whole board; it is now a list of files */
    D.boards = Array.isArray(D.boards) ? D.boards.filter((b) => b && b.id) : [];
    if (!D.boards.length)
      D.boards = [
        {
          id: uid(),
          title: D.board ? "My board" : "Board 1",
          img: D.board || "",
          at: Date.now(),
        },
      ];
    D.boards.forEach((b) => {
      b.img = b.img || "";
      b.title = b.title || "Board";
      b.at = b.at || Date.now();
    });
    if (!D.boards.some((b) => b.id === D.boardCur))
      D.boardCur = D.boards[0].id;
    D.tasks.forEach((t) => {
      t.al = Object.assign({ n: 0, next: 0, last: 0 }, t.al || {});
    });
    D.set = Object.assign(
      {
        sound: true,
        remind: true,
        lead: 10,
        daily: true,
        dailyAt: "09:00",
        lastDaily: "",
        nag: true,
      },
      D.set || {},
    );
  }
  migrate();
  const dueMs = (t) =>
    t.due ? new Date(t.due + "T" + (t.time || "09:00")).getTime() : 0;
  const t12 = (h) => dj("2000-01-01T" + h).format("h:mm A");
  const dueLabel = (t) => {
    if (!t.due) return "";
    const d = dj(t.due),
      n = d.diff(dj().startOf("day"), "day");
    return (
      (n === 0
        ? "Today"
        : n === 1
          ? "Tomorrow"
          : n === -1
            ? "Yesterday"
            : d.format("MMM D")) + (t.time ? ", " + t12(t.time) : "")
    );
  };
  const overdue = (t) =>
    !t.done && t.due && (t.time ? dueMs(t) < Date.now() : t.due < today());
  const cmp = (a, b) =>
    a.done - b.done ||
    (a.due ? dueMs(a) : 9e15) - (b.due ? dueMs(b) : 9e15) ||
    RK[a.p] - RK[b.p];
  const strip = (h) =>
    (h || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  let CH = [];
  const killCh = () => {
    CH.forEach((c) => c.destroy());
    CH = [];
  };
  const last7 = () => {
    const d = [...Array(7)].map((_, i) => dj().subtract(6 - i, "day"));
    return {
      l: d.map((x) => x.format("ddd")),
      k: d.map((x) => x.format("YYYY-MM-DD")),
    };
  };
  const chartOpts = () => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { precision: 0 },
        grid: { color: "#eeece7" },
      },
      x: { grid: { display: false } },
    },
  });
  if (window.Chart) {
    Chart.defaults.font.family = "'Plus Jakarta Sans',Inter,system-ui,sans-serif";
    Chart.defaults.color = "#787774";
  }
  /* SOUND */
  let AC;
  const ac = () => {
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === "suspended") AC.resume();
    } catch (e) {}
    return AC;
  };
  ["pointerdown", "keydown"].forEach((e) =>
    addEventListener(e, ac, { passive: true }),
  );
  function chime(rep = 1) {
    if (!D.set.sound) return;
    const a = ac();
    if (!a) return;
    for (let r = 0; r < rep; r++)
      [659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        const t0 = a.currentTime + r * 1.5 + i * 0.17,
          o = a.createOscillator(),
          g = a.createGain();
        o.type = "sine";
        o.frequency.value = f;
        o.connect(g);
        g.connect(a.destination);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.3, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 1);
        o.start(t0);
        o.stop(t0 + 1.05);
      });
  }
  /* NOTIFICATIONS + REMINDERS (page side) */
  const canN = () => "Notification" in window;
  async function askPerm() {
    if (!canN()) return "unsupported";
    if (Notification.permission === "default")
      try {
        await Notification.requestPermission();
      } catch (e) {}
    if (Notification.permission === "granted") regPeriodic();
    syncSW();
    return Notification.permission;
  }
  async function notify(title, body, tag) {
    chime(1);
    toast(title + ": " + body);
    if (canN() && Notification.permission === "granted") {
      const o = {
        body,
        tag,
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        data: { url: "app.html#tasks" },
      };
      try {
        const r = await navigator.serviceWorker.ready;
        await r.showNotification(title, o);
      } catch (e) {
        try {
          new Notification(title, o);
        } catch (_) {}
      }
    }
  }
  function checkRem() {
    const now = Date.now(),
      s = D.set;
    let ch = 0;
    if (s.remind)
      D.tasks.forEach((t) => {
        if (t.done || !t.due || !t.rem || t.notified) return;
        const d = dueMs(t);
        if (now >= d - s.lead * 60000 && now < d + (t.time ? 864e5 : 216e5)) {
          t.notified = true;
          ch = 1;
          const m = Math.round((d - now) / 6e4);
          notify(
            t.text,
            m > 0
              ? "Due in " + m + " min"
              : m > -2
                ? "Due now"
                : "Was due " + -m + " min ago",
            "task-" + t.id,
          );
        }
      });
    if (s.daily) {
      const k = today(),
        at = new Date(k + "T" + s.dailyAt).getTime();
      if (s.lastDaily !== k && now >= at && now < at + 432e5) {
        s.lastDaily = k;
        ch = 1;
        const o = D.tasks.filter((t) => !t.done),
          dd = o.filter((t) => t.due === k || overdue(t)).length;
        if (o.length)
          notify(
            "Time to work on your tasks",
            o.length +
              " open to-do" +
              (o.length > 1 ? "s" : "") +
              (dd ? ", " + dd + " due today or overdue" : "") +
              ".",
            "daily",
          );
      }
    }
    if (ch) {
      save();
      if (cur === "tasks" || cur === "home") refreshView();
    }
  }

  /* DUE TASK ALARMS + SNOOZE
     A task that is past due and still not ticked off keeps nagging:
     - you can snooze it 3 times, 5 minutes each (15 minutes in total),
     - after that it reminds you once an hour,
     - for a total of 3 days after it was due, then it stops (it stays overdue). */
  const SN_MS = 5 * 60000,
    SN_MAX = 3,
    NAG_TAIL_MS = 60 * 60000,
    NAG_DAYS = 3;
  const alState = (t) => (t.al = t.al || { n: 0, next: 0, last: 0 });
  const nagOk = (t) => {
    if (t.done || !t.due || !D.set.nag) return false;
    const d = dueMs(t),
      now = Date.now();
    if (now < d || now > d + NAG_DAYS * 864e5) return false;
    return now >= alState(t).next;
  };
  function closeNag() {
    const n = $("alm");
    if (n) n.remove();
  }
  function showNag(t) {
    if ($("alm")) return;
    const a = alState(t),
      left = Math.max(0, SN_MAX - a.n),
      late = Math.max(1, Math.round((Date.now() - dueMs(t)) / 6e4));
    a.last = Date.now();
    a.next = Date.now() + (left ? SN_MS : NAG_TAIL_MS);
    t.notified = true;
    save();
    notify(
      "Still not ticked off",
      t.text + " was due " + dueLabel(t) + ".",
      "nag-" + t.id,
    );
    const el = document.createElement("div");
    el.id = "alm";
    el.innerHTML = `<div class="almi" role="alertdialog" aria-modal="true" aria-label="To-do due">
<div class="alh">${ic("bell")}<b>To-do due</b><span>${late >= 120 ? Math.round(late / 60) + " h late" : late + " min late"}</span></div>
<p class="alt">${esc(t.text)}</p><p class="ald">${dueLabel(t)}${overdue(t) ? " · Overdue" : ""}</p>
<p class="als">${left ? "Snooze: " + left + " of " + SN_MAX + " left (" + left * 5 + " min in total)." : "All 3 snoozes used (15 min in total). I will keep reminding you once an hour."} You have " + NAG_DAYS + " days to attend to it.</p>
<div class="btns"><button class="btn p" id="nagdone">${ic("check")}Tick it done</button><button class="btn" id="nagsn" ${left ? "" : "disabled"}>${ic("clock")}Snooze 5 min</button><button class="btn" id="nagopen">Open task</button></div></div>`;
    document.body.appendChild(el);
    $("nagdone").onclick = () => {
      const o = D.tasks.find((x) => x.id === t.id);
      if (o) toggleTask(o);
      closeNag();
      refreshView();
      toast("Marked as done.");
    };
    $("nagsn").onclick = () => {
      const o = D.tasks.find((x) => x.id === t.id);
      if (o) alState(o).n++;
      save();
      closeNag();
      toast("Snoozed for 5 minutes.");
    };
    $("nagopen").onclick = () => {
      closeNag();
      go("tasks");
      openTask(D.tasks.find((x) => x.id === t.id));
    };
    el.onmousedown = (e) => {
      if (e.target === el) {
        closeNag();
        toast("Reminder snoozed for 5 minutes.");
      }
    };
    const escNag = (e) => {
      if (e.key === "Escape" && $("alm")) {
        closeNag();
        removeEventListener("keydown", escNag);
      }
    };
    addEventListener("keydown", escNag);
  }
  function checkAlerts() {
    if ($("alm")) return;
    const t = D.tasks.filter(nagOk).sort(cmp)[0];
    if (t) showNag(t);
  }
  const idb = () =>
    new Promise((res, rej) => {
      const q = indexedDB.open("tf", 1);
      q.onupgradeneeded = () => q.result.createObjectStore("kv");
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  const idbSet = async (k, v) => {
    try {
      const d = await idb();
      await new Promise((r) => {
        const t = d.transaction("kv", "readwrite");
        t.objectStore("kv").put(v, k);
        t.oncomplete = r;
        t.onerror = r;
      });
    } catch (e) {}
  };
  const idbGet = async (k) => {
    try {
      const d = await idb();
      return await new Promise((r) => {
        const q = d.transaction("kv").objectStore("kv").get(k);
        q.onsuccess = () => r(q.result);
        q.onerror = () => r(null);
      });
    } catch (e) {
      return null;
    }
  };
  const idbClear = async () => {
    try {
      const d = await idb();
      await new Promise((r) => {
        const t = d.transaction("kv", "readwrite");
        t.objectStore("kv").clear();
        t.oncomplete = r;
        t.onerror = r;
      });
    } catch (e) {}
  };
  let ss;
  function syncSoon() {
    clearTimeout(ss);
    ss = setTimeout(syncSW, 700);
  }
  async function syncSW() {
    const s = D.set,
      rem = D.tasks
        .filter((t) => !t.done && t.due && t.rem && !t.notified && s.remind)
        .map((t) => ({
          id: t.id,
          title: t.text,
          body: "Due " + dueLabel(t),
          at: dueMs(t) - s.lead * 60000,
        }));
    await idbSet("rem", {
      rem,
      daily: {
        on: s.daily,
        at: s.dailyAt,
        last: s.lastDaily,
        n: D.tasks.filter((t) => !t.done).length,
      },
    });
    if (
      canN() &&
      Notification.permission === "granted" &&
      "showTrigger" in Notification.prototype &&
      window.TimestampTrigger
    ) {
      try {
        const r = await navigator.serviceWorker.ready;
        (await r.getNotifications({ includeTriggered: false })).forEach(
          (n) => n.tag.indexOf("task-") === 0 && n.close(),
        );
        rem.forEach(
          (x) =>
            x.at > Date.now() &&
            r.showNotification(x.title, {
              body: x.body,
              tag: "task-" + x.id,
              icon: "icons/icon-192.png",
              showTrigger: new TimestampTrigger(x.at),
            }),
        );
      } catch (e) {}
    }
  }
  async function regPeriodic() {
    try {
      const r = await navigator.serviceWorker.ready;
      if ("periodicSync" in r) {
        const p = await navigator.permissions.query({
          name: "periodic-background-sync",
        });
        if (p.state === "granted")
          await r.periodicSync.register("tf-remind", { minInterval: 9e5 });
      }
    } catch (e) {}
  }

  /* TASK MODAL + ROWS */
  let fpd, fpt;
/* EMOJI PICKER (emoji-picker-element; its data file is stored locally) */
  function closeEmo() {
    const p = $("emp");
    if (p) p.remove();
    document.removeEventListener("pointerdown", emoOut, true);
  }
  function emoOut(e) {
    const p = $("emp");
    if (p && !p.contains(e.target) && !e.target.closest("#meb")) closeEmo();
  }
  function openEmo(anchor, pick) {
    closeEmo();
    if (!customElements.get("emoji-picker"))
      return toast("The emoji picker could not load.");
    const p = document.createElement("div");
    p.id = "emp";
    p.className = "emp";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "Choose an emoji");
    p.innerHTML =
      '<emoji-picker data-source="vendor/emoji-data-en.json"></emoji-picker><div class="emf"><span>Pick an emoji for this task</span><button type="button" class="btn sm" id="emx">Remove</button></div>';
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect(),
      w = Math.min(344, innerWidth - 24),
      h = Math.min(420, innerHeight - 24);
    let top = r.bottom + 8;
    if (top + h > innerHeight - 12) top = r.top - h - 8;
    top = Math.max(12, Math.min(top, innerHeight - h - 12));
    Object.assign(p.style, {
      width: w + "px",
      height: h + "px",
      top: top + "px",
      left: Math.max(12, Math.min(r.left, innerWidth - w - 12)) + "px",
    });
    p.querySelector("emoji-picker").addEventListener("emoji-click", (e) => {
      pick(e.detail.unicode || "");
      closeEmo();
      anchor.focus();
    });
    $("emx").onclick = () => {
      pick("");
      closeEmo();
      anchor.focus();
    };
    setTimeout(() => document.addEventListener("pointerdown", emoOut, true), 0);
    if (matchMedia("(hover: hover)").matches)
      setTimeout(() => {
        const i = p.querySelector("emoji-picker").shadowRoot;
        i && i.querySelector("input.search") && i.querySelector("input.search").focus();
      }, 250);
  }
  let lastFocus = null;
  /* keep Tab inside an open dialog */
  function trapTab(root) {
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const f = [...root.querySelectorAll("button, input, textarea, select, a[href], [tabindex]:not([tabindex='-1'])")].filter(
        (x) => !x.disabled && x.offsetParent !== null,
      );
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    });
  }
  function closeTask() {
    closeEmo();
    document.body.classList.remove("has-dp");
    document.querySelectorAll(".tk.sel").forEach((r) => r.classList.remove("sel"));
    $("md").innerHTML = "";
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
    fpd && fpd.destroy && fpd.destroy();
    fpt && fpt.destroy && fpt.destroy();
    fpd = fpt = null;
  }
  function refreshView() {
    if (CAL) {
      CAL.refetchEvents();
      if (calRefresh) calRefresh();
      return;
    }
    killCh();
    V()[cur]();
  }
  function delTask(t) {
    D.tasks = D.tasks.filter((x) => x !== t);
    D.trash.unshift({ k: "task", at: Date.now(), item: t });
    if (D.trash.length > 60) D.trash.length = 60;
    log("task", 'Deleted to-do "' + t.text + '"');
    save();
    toast("To-do deleted. Restore it from History.");
  }
  function openTask(init) {
    if ($("md").innerHTML) {
      fpd && fpd.destroy && fpd.destroy();
      fpt && fpt.destroy && fpt.destroy();
    }
    const edit = !!(init && init.id),
      t = Object.assign(
        {
          text: "",
          desc: "",
          p: "med",
          due: "",
          time: "",
          rem: true,
          done: false,
          emo: "",
          steps: [],
          list: "",
          my: "",
          repeat: "",
          est: 0,
          spent: 0,
        },
        init || {},
      );
    let cp = t.p,
      emo = t.emo || "",
      steps = (t.steps || []).map((x) => ({ ...x }));
    $("md").innerHTML =
      `<div class="mdb" id="mdb"><form class="mdc" id="mf" novalidate role="dialog" aria-label="${edit ? "Edit to-do" : "New to-do"}"><div class="mdh"><h3>${edit ? "Edit to-do" : "New to-do"}</h3><button type="button" class="ib" id="mx" aria-label="Close">${ic("x")}</button></div>
<label class="lb2" for="mt">Title</label><div class="ttr"><button type="button" class="emb ${emo ? "has" : ""}" id="meb" aria-label="Choose an emoji" aria-haspopup="dialog" title="Add an emoji">${emo ? esc(emo) : ic("smile-plus")}</button><input class="inp" id="mt" placeholder="What needs doing?" value="${esc(t.text)}" autocomplete="off"></div>
<label class="lb2" for="mds">Description</label><textarea class="inp" id="mds" rows="3" placeholder="Add details, links or steps">${esc(t.desc)}</textarea>
<label class="lb2">Priority</label><div class="prs" id="mp">${Object.keys(PR)
        .map(
          (k) =>
            `<button type="button" data-p="${k}" class="${k === cp ? "on" : ""}" style="--c:${PR[k].c}">${ic("flag")}${PR[k].n}</button>`,
        )
        .join("")}</div>
<div class="dtr"><div><label class="lb2" for="md1">Due date <button type="button" class="lnk" data-clr="d">Clear</button></label><input class="inp" id="md1" placeholder="No date" value="${t.due}"></div><div><label class="lb2" for="md2">Time <button type="button" class="lnk" data-clr="t">Clear</button></label><input class="inp" id="md2" placeholder="Any time" value="${t.time}"></div></div>
<div class="dtr"><div><label class="lb2" for="mls">List</label><select class="inp" id="mls"><option value="">No list</option>${D.lists.map((l) => `<option value="${l.id}" ${l.id === t.list ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div><div><label class="lb2" for="mrp">Repeat</label><select class="inp" id="mrp">${[["", "Does not repeat"], ["daily", "Every day"], ["weekdays", "Every weekday"], ["weekly", "Every week"], ["monthly", "Every month"]].map((o) => `<option value="${o[0]}" ${o[0] === t.repeat ? "selected" : ""}>${o[1]}</option>`).join("")}</select></div></div>
<div class="dtr"><div><label class="lb2" for="mes">Time needed</label><select class="inp" id="mes">${[[0, "Not set"], [5, "5 min"], [15, "15 min"], [30, "30 min"], [45, "45 min"], [60, "1 hour"], [90, "1.5 hours"], [120, "2 hours"], [180, "3 hours"]].map((o) => `<option value="${o[0]}" ${o[0] === t.est ? "selected" : ""}>${o[1]}</option>`).join("")}</select></div><div><label class="lb2">Focused so far</label><div class="inp spent"><span>${t.spent ? fmtMin(t.spent) : "Nothing yet"}</span>${edit && !t.done ? `<button type="button" class="btn sm" id="mfoc">${ic("timer")}Focus</button>` : ""}</div></div></div>
<label class="lb2">Checklist</label><div id="mst"></div><div class="stadd">${ic("plus")}<input class="inp" id="msi" placeholder="Add item" autocomplete="off"></div>
<label class="chk"><input type="checkbox" id="mmy" ${t.my === today() ? "checked" : ""}> Add to My Day</label>
<label class="chk"><input type="checkbox" id="mr" ${t.rem ? "checked" : ""}> Remind me when it is due</label>${edit ? `<label class="chk"><input type="checkbox" id="mdn" ${t.done ? "checked" : ""}> Mark as done</label>` : ""}
<div class="err" id="me" role="alert"></div><div class="mda">${edit ? `<button type="button" class="btn d" id="mdel">${ic("trash")}Delete</button>` : ""}<span class="sp"></span><button type="button" class="btn" id="mc">Cancel</button><button class="btn p">${edit ? "Save changes" : "Add to-do"}</button></div></form></div>`;
    fpd = flatpickr("#md1", {
      dateFormat: "Y-m-d",
      altInput: true,
      altFormat: "D, M j, Y",
      altInputClass: "inp",
      disableMobile: true,
      defaultDate: t.due || null,
    });
    fpt = flatpickr("#md2", {
      enableTime: true,
      noCalendar: true,
      dateFormat: "H:i",
      altInput: true,
      altFormat: "h:i K",
      altInputClass: "inp",
      disableMobile: true,
      defaultDate: t.time || null,
    });
    lastFocus = document.activeElement;
    const docked = innerWidth >= 1000;
    document.body.classList.toggle("has-dp", docked);
    if (edit) document.querySelectorAll(".tk").forEach((r) => r.classList.toggle("sel", r.dataset.id === t.id));
    if (!docked) {
      $("mf").setAttribute("aria-modal", "true");
      trapTab($("mf"));
    }
    $("mt").focus();
    $("mx").onclick = $("mc").onclick = closeTask;
    $("mdb").onmousedown = (e) => {
      if (e.target.id === "mdb") closeTask();
    };
    $("mp").onclick = (e) => {
      const b = e.target.closest("[data-p]");
      if (!b) return;
      cp = b.dataset.p;
      $("mp")
        .querySelectorAll("button")
        .forEach((x) => x.classList.toggle("on", x === b));
    };
    const setEmo = (v) => {
      emo = cleanEmo(v);
      const b = $("meb");
      b.classList.toggle("has", !!emo);
      b.innerHTML = emo ? esc(emo) : ic("smile-plus");
    };
    $("meb").onclick = () => ($("emp") ? closeEmo() : openEmo($("meb"), setEmo));
    const drawSteps = () => {
      $("mst").innerHTML = steps.map((x, i) => `<div class="sti ${x.done ? "done" : ""}"><input type="checkbox" class="ck" data-i="${i}" ${x.done ? "checked" : ""} aria-label="Done"><span>${esc(x.text)}</span><button type="button" class="x" data-d="${i}" aria-label="Remove item">${ic("x")}</button></div>`).join("");
    };
    drawSteps();
    $("mst").onclick = (e) => {
      const c = e.target.closest(".ck"), x = e.target.closest("[data-d]");
      if (c) steps[+c.dataset.i].done = c.checked;
      else if (x) steps.splice(+x.dataset.d, 1);
      else return;
      drawSteps();
    };
    $("msi").onkeydown = (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const v = e.target.value.trim();
      if (v) steps.push({ id: uid(), text: v, done: false });
      e.target.value = "";
      drawSteps();
    };
    if ($("mfoc")) $("mfoc").onclick = () => { closeTask(); startT(D.timer.kind === "focus" ? D.timer.mode : 25, "focus", t.id); };
    $("mf").onclick = (e) => {
      const c = e.target.closest("[data-clr]");
      if (c) (c.dataset.clr === "d" ? fpd : fpt).clear();
    };
    if (edit)
      $("mdel").onclick = () => {
        const o = D.tasks.find((x) => x.id === t.id);
        if (o) delTask(o);
        closeTask();
        refreshView();
      };
    $("mf").onsubmit = (e) => {
      e.preventDefault();
      const text = $("mt").value.trim();
      if (!text) {
        $("me").textContent = "Please enter a title.";
        return;
      }
      let due = $("md1").value,
        time = $("md2").value;
      if (time && !due) due = today();
      const f = {
        text,
        desc: $("mds").value.trim(),
        p: cp,
        due,
        time,
        rem: $("mr").checked,
        emo: cleanEmo(emo),
        steps: (() => { const v = $("msi").value.trim(); return v ? [...steps, { id: uid(), text: v, done: false }] : steps; })(),
        list: $("mls").value,
        repeat: $("mrp").value,
        est: +$("mes").value,
        my: $("mmy").checked ? today() : "",
      };
      if (edit) {
        const o = D.tasks.find((x) => x.id === t.id);
        Object.assign(o, f, {
          notified: dueMs(f) - D.set.lead * 6e4 <= Date.now(),
        });
        if ($("mdn").checked !== o.done) {
          o.done = $("mdn").checked;
          o.doneAt = o.done ? Date.now() : 0;
        }
        log("task", 'Edited to-do "' + text + '"');
      } else {
        D.tasks.unshift(
          Object.assign(
            {
              id: uid(),
              done: false,
              at: Date.now(),
              notified: !due || dueMs(f) - D.set.lead * 6e4 <= Date.now(),
            },
            f,
          ),
        );
        log("task", 'Added to-do "' + text + '"');
      }
      save();
      closeTask();
      refreshView();
      checkRem();
    };
  }
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("pmenu")) {
        closePMenu();
        return;
      }
      if ($("emp")) {
        closeEmo();
        return;
      }
      if ($("md").innerHTML) closeTask();
      if ($("sr").innerHTML) $("sr").innerHTML = "";
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearch();
    }
  });
  /* ---------- to-do helpers: lists, repeat, time, quick add ---------- */
  const fmtMin = (m) => (m >= 60 ? Math.floor(m / 60) + "h" + (m % 60 ? " " + (m % 60) + "m" : "") : m + "m");
  const LIST_COLORS = ["#F97316", "#2563eb", "#16a34a", "#9333ea", "#db2777", "#0d9488", "#dc2626", "#475569"];
  function nextDue(t) {
    const d = dj(t.due);
    if (t.repeat === "daily") return d.add(1, "day");
    if (t.repeat === "weekly") return d.add(1, "week");
    if (t.repeat === "monthly") return d.add(1, "month");
    if (t.repeat === "weekdays") {
      let n = d.add(1, "day");
      while (n.day() === 0 || n.day() === 6) n = n.add(1, "day");
      return n;
    }
    return null;
  }
  function addSpent(id, min) {
    const t = D.tasks.find((x) => x.id === id);
    if (t && min > 0) t.spent = (t.spent || 0) + min;
  }
  function toggleTask(t) {
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : 0;
    if (t.done) {
      t.notified = true;
      t.al = { n: 0, next: 0, last: 0 };
      const n = t.repeat && t.due ? nextDue(t) : null;
      if (n) {
        D.tasks.unshift(
          Object.assign({}, t, {
            id: uid(),
            done: false,
            doneAt: 0,
            due: n.format("YYYY-MM-DD"),
            my: "",
            at: Date.now(),
            notified: false,
            spent: 0,
            al: { n: 0, next: 0, last: 0 },
            steps: (t.steps || []).map((s) => ({ ...s, done: false })),
          }),
        );
        toast("Next one is set for " + n.format("ddd, MMM D") + ".");
      }
    }
    log("task", (t.done ? "Completed" : "Reopened") + ' to-do "' + t.text + '"');
    save();
  }

  /** "Call supplier tomorrow 4pm !high #business ~30m every week" -> a filled-in to-do. */
  function parseQuick(raw) {
    const out = { text: "", due: "", time: "", p: "med", list: "", repeat: "", est: 0 };
    let s = " " + raw.trim() + " ";
    const cut = (rx, fn) => {
      const m = rx.exec(s);
      if (m && fn(m) !== false) s = s.replace(m[0], " ");
    };
    cut(/\s!(high|h|urgent)\b/i, () => (out.p = "high"));
    cut(/\s!(low|l)\b/i, () => (out.p = "low"));
    cut(/\s!(med|medium|m)\b/i, () => (out.p = "med"));
    cut(/\s#([\w-]+)/, (m) => {
      const l = D.lists.find((x) => x.name.toLowerCase().replace(/\s+/g, "-") === m[1].toLowerCase());
      if (!l) return false;
      out.list = l.id;
    });
    cut(/\s~(\d+)\s?(m|min|h|hr)?\b/i, (m) => (out.est = Math.min(600, +m[1] * (/^h/i.test(m[2] || "") ? 60 : 1))));
    cut(/\severy\s+weekday\b|\sweekdays\b/i, () => (out.repeat = "weekdays"));
    cut(/\severy\s+day\b|\sdaily\b/i, () => (out.repeat = "daily"));
    cut(/\severy\s+week\b|\sweekly\b/i, () => (out.repeat = "weekly"));
    cut(/\severy\s+month\b|\smonthly\b/i, () => (out.repeat = "monthly"));
    cut(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i, (m) => {
      out.time = pad((+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0)) + ":" + (m[2] || "00");
    });
    cut(/\sat\s+(\d{1,2}):(\d{2})\b/i, (m) => (out.time = pad(+m[1]) + ":" + m[2]));
    cut(/\s(today|tonight|tomorrow|tmrw)\b/i, (m) => (out.due = dj().add(/^(tomorrow|tmrw)/i.test(m[1]) ? 1 : 0, "day").format("YYYY-MM-DD")));
    cut(/\sin\s+(\d+)\s+days?\b/i, (m) => (out.due = dj().add(+m[1], "day").format("YYYY-MM-DD")));
    cut(/\s(?:on\s+|next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i, (m) => {
      const want = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(m[1].toLowerCase().slice(0, 3));
      let d = dj().startOf("day");
      do d = d.add(1, "day");
      while (d.day() !== want);
      out.due = d.format("YYYY-MM-DD");
    });
    if (out.time && !out.due) out.due = today();
    out.text = s.replace(/\s+/g, " ").trim() || raw.trim();
    return out;
  }

  /** A small centred dialog (the to-do panel docks to the side instead). */
  function dialog(html) {
    $("md").innerHTML = `<div class="mdb ctr" id="mdb"><div class="mdc" role="dialog" aria-modal="true">${html}</div></div>`;
    $("mdb").onmousedown = (e) => {
      if (e.target.id === "mdb") closeTask();
    };
    trapTab($("mdb"));
  }

  function openList(list) {
    const l = list || { name: "", color: LIST_COLORS[D.lists.length % LIST_COLORS.length] };
    let color = l.color;
    dialog(`<div class="mdh"><h3>${list ? "Edit list" : "New list"}</h3><button type="button" class="ib" id="lx" aria-label="Close">${ic("x")}</button></div>
<label class="lb2" for="ln">Name</label><input class="inp" id="ln" maxlength="40" value="${esc(l.name)}" placeholder="For example: Business" autocomplete="off">
<label class="lb2">Colour</label><div class="swt" id="lc">${LIST_COLORS.map((c) => `<button type="button" class="swb ${c === color ? "on" : ""}" data-c="${c}" style="--c:${c}" aria-label="${c}"></button>`).join("")}</div>
<div class="mda">${list ? `<button type="button" class="btn d" id="ld">${ic("trash")}Delete list</button>` : ""}<span class="sp"></span><button type="button" class="btn" id="lcn">Cancel</button><button type="button" class="btn p" id="ls">Save</button></div>`);
    $("ln").focus();
    $("lx").onclick = $("lcn").onclick = closeTask;
    $("lc").onclick = (e) => {
      const b = e.target.closest("[data-c]");
      if (!b) return;
      color = b.dataset.c;
      document.querySelectorAll("#lc .swb").forEach((x) => x.classList.toggle("on", x === b));
    };
    $("ls").onclick = () => {
      const name = $("ln").value.trim();
      if (!name) return toast("Give the list a name.");
      if (list) {
        list.name = name;
        list.color = color;
      } else {
        const n = { id: uid(), name, color };
        D.lists.push(n);
        curList = n.id;
      }
      log("task", (list ? "Edited" : "Created") + ' list "' + name + '"');
      save();
      closeTask();
      go("tasks");
    };
    if (list)
      $("ld").onclick = () => {
        if (!confirm('Delete the list "' + list.name + '"? Its to-dos are kept in Everything.')) return;
        D.lists = D.lists.filter((x) => x !== list);
        D.tasks.forEach((t) => {
          if (t.list === list.id) t.list = "";
        });
        log("task", 'Deleted list "' + list.name + '"');
        curList = "myday";
        save();
        closeTask();
        go("tasks");
      };
  }

  function wrapUp() {
    const day = today(),
      doneToday = D.tasks.filter((t) => t.done && t.doneAt && dj(t.doneAt).format("YYYY-MM-DD") === day).length,
      focusMin = D.focus.filter((f) => dj(f.at).format("YYYY-MM-DD") === day).reduce((a, f) => a + f.min, 0),
      left = D.tasks.filter((t) => !t.done && t.my === day);
    dialog(`<div class="mdh"><h3>Wrap up your day</h3><button type="button" class="ib" id="wx" aria-label="Close">${ic("x")}</button></div>
<div class="tsg wr"><div><b>${doneToday}</b><span>Finished</span></div><div><b>${fmtMin(focusMin)}</b><span>Focused</span></div><div><b>${left.length}</b><span>Left over</span></div></div>
${left.length ? `<p class="sub" style="margin:12px 0 6px">Still open from today:</p>${left.map((t) => `<div class="row">${esc(t.text)}</div>`).join("")}` : `<p class="sub" style="margin-top:12px">Everything planned for today is done. Nice work.</p>`}
<div class="mda"><span class="sp"></span><button type="button" class="btn" id="wc">Close</button>${left.length ? `<button type="button" class="btn p" id="wm">Move to tomorrow</button>` : ""}</div>`);
    $("wx").onclick = $("wc").onclick = closeTask;
    if (left.length)
      $("wm").onclick = () => {
        const tomorrow = dj().add(1, "day").format("YYYY-MM-DD");
        left.forEach((t) => (t.my = tomorrow));
        log("task", "Moved " + left.length + " to-do(s) to tomorrow");
        save();
        closeTask();
        refreshView();
        toast("Moved to tomorrow's My Day.");
      };
  }

  const taskRow = (t, showList) => {
    const steps = t.steps || [],
      doneSteps = steps.filter((s) => s.done).length,
      l = showList ? D.lists.find((x) => x.id === t.list) : null,
      chip = (icon, text, cls) => `<span class="du ${cls || ""}">${icon}${text}</span>`;
    return `<div class="tk ${t.done ? "done" : ""}" data-id="${t.id}" style="--c:${PR[t.p].c}"><input type="checkbox" class="ck" ${t.done ? "checked" : ""} aria-label="Mark done">${t.emo ? `<span class="te" aria-hidden="true">${esc(t.emo)}</span>` : ""}<div class="tb2"><div class="tt2">${esc(t.text)}</div>${t.desc ? `<div class="td2">${esc(t.desc)}</div>` : ""}<div class="tm2">${t.p !== "med" ? `<span class="pp">${ic("flag")}${PR[t.p].n}</span>` : ""}${t.due ? chip(ic("clock"), dueLabel(t) + (overdue(t) ? " \u00b7 Overdue" : ""), overdue(t) ? "od" : "") : ""}${steps.length ? chip(ic("list"), doneSteps + "/" + steps.length) : ""}${t.repeat ? chip(ic("rep"), "") : ""}${t.est || t.spent ? chip(ic("timer"), (t.spent ? fmtMin(t.spent) + (t.est ? " / " : "") : "") + (t.est ? fmtMin(t.est) : "")) : ""}${l ? `<span class="du"><i class="ldot" style="background:${esc(l.color)}"></i>${esc(l.name)}</span>` : ""}${t.rem && t.due && !t.done ? chip(ic("bell"), "") : ""}</div></div><button class="x" aria-label="Delete to-do">${ic("trash")}</button></div>`;
  };
  const miniRow = (t) =>
    `<div class="row" data-open="${t.id}" style="cursor:pointer"><span class="pdot" style="--c:${PR[t.p].c}" title="${PR[t.p].n} priority"></span><span class="t">${t.emo ? `<span class="emo">${esc(t.emo)}</span>` : ""}${esc(t.text)}${t.due ? `<small class="dt ${overdue(t) ? "od" : ""}">${dueLabel(t)}</small>` : ""}</span></div>`;

  /* TO-DOS (one view; the sidebar chooses which list it shows) */
  let showDone = false;
  function tasks() {
    if (!SMART.some((x) => x[0] === curList) && !D.lists.some((l) => l.id === curList)) curList = "myday";
    const lst = D.lists.find((l) => l.id === curList),
      all = D.tasks.filter((t) => inList(t, curList)),
      open = all.filter((t) => !t.done).sort(cmp),
      done = all.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)),
      planned = open.reduce((a, t) => a + (t.est || 0), 0),
      cap = D.set.cap || 360,
      sug =
        curList === "myday"
          ? D.tasks.filter((t) => !t.done && t.my !== today() && (overdue(t) || t.due === today())).slice(0, 5)
          : [];
    $("v").innerHTML = `<div class="in"><div class="ph"><div><h1>${esc(listLabel(curList))}</h1><p class="sub">${curList === "myday" ? dj().format("dddd, MMMM D") : open.length + " to do"}</p></div><div class="btns">${lst ? `<button class="btn sm" id="lse">${ic("pen")}Edit list</button>` : ""}${curList === "myday" ? `<button class="btn sm" id="wrap">${ic("check")}Wrap up day</button>` : ""}</div></div>
${curList === "myday" && planned ? `<div class="gauge ${planned > cap ? "over" : ""}"><div class="gb"><i style="width:${Math.min(100, (planned / cap) * 100)}%"></i></div><span>Planned ${fmtMin(planned)} of ${fmtMin(cap)}${planned > cap ? ", over by " + fmtMin(planned - cap) : ""}</span></div>` : ""}
<form class="add" id="tf"><input class="inp" id="ti" placeholder="What's next?  Try: Call supplier tomorrow 4pm !high" autocomplete="off" aria-label="Add a to-do"><button class="btn p">Add</button></form>
${sug.length ? `<h3 class="sec">Suggested for today</h3>${sug.map((t) => `<div class="sug"><span>${esc(t.text)}<small class="dt ${overdue(t) ? "od" : ""}">${dueLabel(t)}</small></span><button class="btn sm" data-my="${t.id}">${ic("plus")}Add to My Day</button></div>`).join("")}<h3 class="sec">My Day</h3>` : ""}
<div id="tl">${open.map((t) => taskRow(t, !lst)).join("") || empty("tasks", "Nothing here yet", curList === "myday" ? "Add something above to plan your day." : "Add a to-do above.")}</div>
${done.length ? `<button class="lnk" id="tgd" style="margin:14px 0 8px">${showDone ? "Hide" : "Show"} completed (${done.length})</button>${showDone ? `<div id="td">${done.map((t) => taskRow(t, !lst)).join("")}</div>` : ""}` : ""}</div>`;
    $("tf").onsubmit = (e) => {
      e.preventDefault();
      const raw = $("ti").value.trim();
      if (!raw) return;
      const q = parseQuick(raw),
        t = {
          id: uid(), text: q.text, desc: "", p: curList === "priority" && q.p === "med" ? "high" : q.p, due: q.due, time: q.time,
          rem: !!q.due, done: false, at: Date.now(), list: q.list || (lst ? lst.id : ""), my: curList === "myday" ? today() : "",
          repeat: q.repeat, est: q.est, spent: 0, steps: [], notified: !q.due || dueMs(q) - D.set.lead * 6e4 <= Date.now(),
        };
      D.tasks.unshift(t);
      log("task", 'Added to-do "' + t.text + '"');
      save();
      tasks();
      $("ti").focus();
      checkRem();
    };
    const rows = (e) => {
      const r = e.target.closest(".tk");
      if (!r) return;
      const t = D.tasks.find((x) => x.id === r.dataset.id);
      if (e.target.closest(".x")) delTask(t);
      else if (e.target.classList.contains("ck")) toggleTask(t);
      else return openTask(t);
      tasks();
    };
    $("tl").onclick = rows;
    if ($("td")) $("td").onclick = rows;
    if ($("tgd")) $("tgd").onclick = () => ((showDone = !showDone), tasks());
    if ($("lse")) $("lse").onclick = () => openList(lst);
    if ($("wrap")) $("wrap").onclick = wrapUp;
    $("v").querySelectorAll("[data-my]").forEach((b) => (b.onclick = () => {
      D.tasks.find((t) => t.id === b.dataset.my).my = today();
      save();
      tasks();
    }));
  }

  /* SEARCH (Fuse.js) */
  function openSearch() {
    const items = [
        ...D.tasks.map((t) => ({
          k: "task",
          id: t.id,
          title: t.text,
          body: t.desc,
        })),
        ...D.notes.map((n) => ({
          k: "note",
          id: n.id,
          title: n.title || "Untitled",
          body: strip(n.body),
        })),
      ],
      fu = new Fuse(items, {
        keys: [{ name: "title", weight: 2 }, "body"],
        threshold: 0.35,
        ignoreLocation: true,
      });
    $("sr").innerHTML =
      `<div class="mdb top2" id="srb"><div class="src"><div class="srh">${ic("search")}<input id="sq" placeholder="Search tasks and notes" autocomplete="off" aria-label="Search"><kbd>Esc</kbd></div><div id="srl"></div></div></div>`;
    const draw = () => {
      const q = $("sq").value.trim(),
        r = (q ? fu.search(q).map((x) => x.item) : items).slice(0, 8);
      $("srl").innerHTML =
        r
          .map(
            (x) =>
              `<button class="sri" data-k="${x.k}" data-id="${x.id}">${ic(x.k === "task" ? "check" : "note")}<span>${esc(x.title)}</span><small>${x.k === "task" ? "Task" : "Note"}</small></button>`,
          )
          .join("") || '<div class="empty" style="border:0">No matches.</div>';
    };
    draw();
    $("sq").focus();
    $("sq").oninput = draw;
    const pick = (b) => {
      $("sr").innerHTML = "";
      if (b.dataset.k === "task")
        openTask(D.tasks.find((t) => t.id === b.dataset.id));
      else {
        nid = b.dataset.id;
        go("notes");
      }
    };
    $("srl").onclick = (e) => {
      const b = e.target.closest(".sri");
      if (b) pick(b);
    };
    $("sq").onkeydown = (e) => {
      if (e.key === "Enter") {
        const b = $("srl").querySelector(".sri");
        b && pick(b);
      }
    };
    $("srb").onmousedown = (e) => {
      if (e.target.id === "srb") $("sr").innerHTML = "";
    };
  }

  /* HISTORY */
  let hf = "all",
    hq = "";
  function histView() {
    const K = {
        task: ["To-dos", "#i"],
        note: ["Notes"],
        event: ["Calendar"],
        timer: ["Timer"],
        board: ["Whiteboard"],
      },
      IC = {
        task: ic("check"),
        note: ic("note"),
        event: ic("cal"),
        timer: ic("timer"),
        board: ic("pen"),
      };
    $("v").innerHTML =
      `<div class="in"><h1>History</h1><p class="sub">Everything you have added, finished or deleted.</p>
<div class="add"><input class="inp" id="hs" type="search" placeholder="Search history" value="${esc(hq)}"><button class="btn d" id="hc">Clear history</button></div>
<div class="flt" style="flex-wrap:wrap">${["all", "task", "note", "event", "timer", "board"].map((f) => `<button class="btn sm ${f === hf ? "on" : ""}" data-f="${f}">${f === "all" ? "All" : K[f][0]}</button>`).join("")}</div><div id="hl"></div>
<h3 class="sec">Recently deleted</h3><div id="ht"></div></div>`;
    const day = (ts) => {
      const d = new Date(ts),
        t = today(),
        y = key(new Date(Date.now() - 864e5));
      return key(d) === t
        ? "Today"
        : key(d) === y
          ? "Yesterday"
          : d.toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            });
    };
    const draw = () => {
      const q = hq.toLowerCase(),
        l = D.log.filter(
          (e) => (hf === "all" || e.k === hf) && e.t.toLowerCase().includes(q),
        );
      let last = "",
        h = "";
      l.forEach((e) => {
        const d = day(e.at);
        if (d !== last) {
          h += `<h3 class="sec">${d}</h3>`;
          last = d;
        }
        h += `<div class="row"><span class="hic">${IC[e.k] || "\u2022"}</span><span class="t">${esc(e.t)}</span><span class="pri">${tshort(e.at)}</span></div>`;
      });
      $("hl").innerHTML =
        h ||
        empty(
          "hist",
          "No history yet",
          "Add a to-do or write a note and it will show up here.",
        );
      $("ht").innerHTML =
        D.trash
          .map(
            (x, i) =>
              `<div class="row" data-i="${i}"><span class="hic">${IC[x.k]}</span><span class="t">${esc(x.k === "task" ? x.item.text : x.item.title || "Untitled")}<small class="dt">Deleted ${dshort(x.at)}, ${tshort(x.at)}</small></span><button class="btn sm">Restore</button></div>`,
          )
          .join("") ||
        empty(
          "hist",
          "Nothing deleted",
          "Deleted tasks and notes can be restored from here.",
        );
    };
    draw();
    $("hs").oninput = (e) => {
      hq = e.target.value;
      draw();
    };
    $("v").querySelector(".flt").onclick = (e) => {
      const b = e.target.closest("[data-f]");
      if (b) {
        hf = b.dataset.f;
        histView();
      }
    };
    $("hc").onclick = () => {
      if (confirm("Clear all history? Deleted items stay restorable.")) {
        D.log = [];
        save();
        histView();
      }
    };
    $("ht").onclick = (e) => {
      const r = e.target.closest(".row");
      if (!r || !e.target.closest(".btn")) return;
      const x = D.trash.splice(+r.dataset.i, 1)[0];
      if (x.k === "task") {
        D.tasks.unshift(x.item);
        log("task", 'Restored task "' + x.item.text + '"');
      } else {
        D.notes.unshift(x.item);
        log("note", 'Restored note "' + (x.item.title || "Untitled") + '"');
      }
      save();
      toast("Restored");
      histView();
    };
  }

  /* ILLUSTRATIONS */
  const IL = {
    hero: '<svg class="il" viewBox="0 0 200 140" aria-hidden="true"><rect x="22" y="18" width="116" height="98" rx="14" fill="#fff" stroke="#ecd9c6" stroke-width="2"/><path d="M22 44V32a14 14 0 0 1 14-14h88a14 14 0 0 1 14 14v12z" fill="var(--ac)"/><g fill="#ecd9c6"><circle cx="44" cy="62" r="4"/><circle cx="64" cy="62" r="4"/><circle cx="84" cy="62" r="4"/><circle cx="104" cy="62" r="4"/><circle cx="44" cy="82" r="4"/><circle cx="84" cy="82" r="4"/><circle cx="104" cy="82" r="4"/><circle cx="44" cy="102" r="4"/></g><circle cx="64" cy="82" r="8" fill="var(--ac)"/><circle cx="144" cy="96" r="30" fill="#fff" stroke="#16140f" stroke-width="3"/><path d="M144 78v18l11 7" stroke="#16140f" stroke-width="4" fill="none" stroke-linecap="round"/><g transform="translate(150 14)"><rect width="38" height="38" rx="11" fill="#16140f"/><path d="m11 20 6 6 11-13" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></svg>',
    tasks:
      '<svg viewBox="0 0 160 110" aria-hidden="true"><rect x="40" y="10" width="80" height="92" rx="12" fill="#fff" stroke="#e1ded5" stroke-width="3"/><rect x="62" y="4" width="36" height="14" rx="6" fill="#16140f"/><circle cx="58" cy="40" r="6" fill="var(--ac)"/><circle cx="58" cy="62" r="6" fill="var(--ac)"/><circle cx="58" cy="84" r="6" fill="none" stroke="#e1ded5" stroke-width="3"/><path d="M72 40h34M72 62h26M72 84h30" stroke="#e1ded5" stroke-width="4" stroke-linecap="round"/></svg>',
    notes:
      '<svg viewBox="0 0 160 110" aria-hidden="true"><rect x="42" y="10" width="72" height="92" rx="10" fill="#fff" stroke="#e1ded5" stroke-width="3"/><path d="M58 52h40M58 66h34M58 80h22" stroke="#e1ded5" stroke-width="4" stroke-linecap="round"/><path d="M58 34h28" stroke="var(--ac)" stroke-width="5" stroke-linecap="round"/><path d="m100 88 28-40 10 7-28 40-13 4z" fill="#2563eb"/></svg>',
    cal: '<svg viewBox="0 0 160 110" aria-hidden="true"><rect x="32" y="14" width="96" height="88" rx="12" fill="#fff" stroke="#e1ded5" stroke-width="3"/><path d="M32 40h96" stroke="#e1ded5" stroke-width="3"/><path d="M58 8v14M102 8v14" stroke="#16140f" stroke-width="4" stroke-linecap="round"/><g fill="#e1ded5"><circle cx="52" cy="58" r="4"/><circle cx="80" cy="58" r="4"/><circle cx="108" cy="58" r="4"/><circle cx="52" cy="80" r="4"/><circle cx="108" cy="80" r="4"/></g><circle cx="80" cy="80" r="8" fill="var(--ac)"/></svg>',
    hist: '<svg viewBox="0 0 160 110" aria-hidden="true"><circle cx="80" cy="55" r="40" fill="#fff" stroke="#e1ded5" stroke-width="3"/><path d="M80 30v26l16 10" stroke="#16140f" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M40 38a46 46 0 0 1 24-18" stroke="var(--ac)" stroke-width="5" fill="none" stroke-linecap="round"/></svg>',
  };
  const empty = (k, t, sub) =>
    `<div class="empty">${IL[k]}<b>${t}</b><span>${sub}</span></div>`;

  const AVATARS = [["\u{1F981}", "#fde68a"], ["\u{1F43C}", "#e5e7eb"], ["\u{1F98A}", "#fed7aa"], ["\u{1F438}", "#bbf7d0"], ["\u{1F984}", "#fbcfe8"], ["\u{1F680}", "#bfdbfe"], ["\u{1F33F}", "#d9f99d"], ["\u{1F525}", "#fecaca"], ["\u{1F4DA}", "#ddd6fe"], ["\u{1F3A7}", "#a5f3fc"], ["\u{26A1}", "#fef08a"], ["\u{1F3AF}", "#fca5a5"]];
  /* PROFILE and THEME (account holders only) */
  const cssVar = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const accent = () => cssVar("--ac", "#F97316");
  const accent2 = () => cssVar("--ac2", "#ea580c");

  /** Save a profile change on this device and, for cloud accounts, upload it. */
  function saveProfile(patch) {
    if (!TFProfile.set(user.email, patch, useCloud ? user.id : "")) {
      toast("There is not enough space on this device to save that.");
      return false;
    }
    profile = TFProfile.get(user.email);
    if ("name" in patch) {
      user.name = patch.name;
      try {
        const session = JSON.parse(localStorage.getItem("tf_user"));
        session.name = patch.name;
        localStorage.setItem("tf_user", JSON.stringify(session));
      } catch (e) {
        /* the session record is rewritten at the next sign-in */
      }
    }
    paintIdentity();
    return true;
  }

  function closePMenu() {
    const menu = $("pmenu");
    if (menu) menu.remove();
    $("pbtn").setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", pmenuOutside, true);
  }
  function pmenuOutside(e) {
    const menu = $("pmenu");
    if (menu && !menu.contains(e.target) && !e.target.closest("#pbtn")) closePMenu();
  }
  function togglePMenu() {
    if ($("pmenu")) return closePMenu();
    const menu = document.createElement("div");
    menu.id = "pmenu";
    menu.className = "pmenu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `<div class="pmh"><span class="pma">${avatarHTML()}</span><div><b>${esc(user.name)}</b><small>${esc(user.email)}</small></div></div>
<button role="menuitem" data-a="profile">${ic("user")}Profile and theme</button><button role="menuitem" data-a="settings">${ic("set")}Settings</button><button role="menuitem" class="d" data-a="out">${ic("out")}Log out</button>`;
    document.body.appendChild(menu);
    const r = $("pbtn").getBoundingClientRect();
    menu.style.top = r.bottom + 8 + "px";
    menu.style.right = Math.max(12, innerWidth - r.right) + "px";
    menu.onclick = (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      closePMenu();
      if (b.dataset.a === "out") signOutFlow();
      else go(b.dataset.a);
    };
    $("pbtn").setAttribute("aria-expanded", "true");
    setTimeout(() => document.addEventListener("pointerdown", pmenuOutside, true), 0);
  }
  $("pbtn").onclick = togglePMenu;

  function profileView() {
    if (isGuest) {
      toast("Create an account to use a profile.");
      return go("home");
    }
    const theme = TFProfile.isHex(profile.theme) ? profile.theme.toUpperCase() : TFProfile.DEFAULT_THEME;
    $("v").innerHTML = `<div class="in"><h1>Profile</h1><p class="sub">Your photo, name and theme colour.</p>
<div class="panel"><div class="pfa"><button class="pfav" id="pfav" aria-label="Change profile photo">${avatarHTML()}<span class="pfc">${ic("camera")}</span></button>
<div class="pfi"><label class="lb2" for="pfn">Display name</label><input class="inp" id="pfn" maxlength="40" value="${esc(user.name)}" autocomplete="name"><p class="dt" style="margin-top:6px">${esc(user.email)}</p>
<div class="btns" style="margin-top:10px"><button class="btn sm" id="pfu">Upload photo</button><button class="btn sm" id="pfr" ${profile.avatar ? "" : "hidden"}>Remove photo</button></div></div></div>
<div class="avg"><span class="lb2">Or pick an avatar</span><div class="avr" id="avr">${AVATARS.map((a) => `<button type="button" class="avb" data-e="${a[0]}" data-bg="${a[1]}" style="background:${a[1]}" aria-label="Avatar ${a[0]}">${a[0]}</button>`).join("")}</div></div>
<input type="file" id="pff" accept="image/*" hidden></div>
<div class="pst"><div><b>${D.tasks.filter((t) => t.done).length}</b><span>To-dos done</span></div><div><b>${fmtMin(D.focus.reduce((a, f) => a + f.min, 0))}</b><span>Focused</span></div><div><b>${(() => { let n = 0; for (let i = 0; i < 400; i++) { const d = dj().subtract(i, "day").format("YYYY-MM-DD"); if (D.focus.some((f) => dj(f.at).format("YYYY-MM-DD") === d)) n++; else if (i > 0) break; } return n; })()}</b><span>Day streak</span></div></div>
<h3 class="sec">Theme colour</h3><div class="panel"><div class="swt" id="swt">${TFProfile.PRESETS.map((p) => `<button class="swb ${p[1].toUpperCase() === theme ? "on" : ""}" data-c="${p[1]}" style="--c:${p[1]}" title="${p[0]}" aria-label="${p[0]}"></button>`).join("")}<label class="swb cust" title="Pick any colour"><input type="color" id="pfc" value="${theme.toLowerCase()}" aria-label="Custom colour"></label></div>
<div class="btns" style="margin-top:14px"><button class="btn sm" id="pfd">Reset to orange</button></div></div>
${
  useCloud
    ? `<h3 class="sec">Sync</h3><div class="panel"><div class="srow"><span><b id="syl">Checking...</b><small>Your tasks, notes and whiteboards follow you to every device you sign in on.</small></span><button class="btn sm" id="sys">Sync now</button></div>
<div class="srow"><span><b>Change password</b><small>At least ${TFAuth.minPassword} characters.</small></span><span class="btns"><input class="inp sel" id="pfp" type="password" autocomplete="new-password" placeholder="New password" style="width:170px"><button class="btn sm" id="pfs">Update</button></span></div></div>`
    : `<p class="legal" style="text-align:left;margin-top:18px">This account lives on this device only. Your data is not uploaded anywhere.</p>`
}
<h3 class="sec">Account</h3><div class="panel"><div class="btns"><button class="btn d" id="pfo">${ic("out")}Log out</button></div></div></div>`;

    const fileInput = $("pff");
    $("pfn").onchange = (e) => {
      const name = e.target.value.trim();
      if (!name) e.target.value = user.name;
      else saveProfile({ name });
    };
    $("pfu").onclick = $("pfav").onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      try {
        const avatar = await TFProfile.avatarFromFile(fileInput.files[0]);
        if (saveProfile({ avatar })) profileView();
      } catch (error) {
        toast(error.message);
      }
    };
    $("pfr").onclick = () => saveProfile({ avatar: "" }) && profileView();
    $("avr").onclick = (e) => {
      const b = e.target.closest("[data-e]");
      if (!b) return;
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const g = c.getContext("2d");
      g.fillStyle = b.dataset.bg;
      g.fillRect(0, 0, 256, 256);
      g.font = '140px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(b.dataset.e, 128, 142);
      if (saveProfile({ avatar: c.toDataURL("image/jpeg", 0.9) })) profileView();
    };
    const mark = (hex) =>
      document.querySelectorAll("#swt .swb[data-c]").forEach((b) =>
        b.classList.toggle("on", b.dataset.c.toUpperCase() === String(hex).toUpperCase()),
      );
    $("swt").onclick = (e) => {
      const b = e.target.closest(".swb[data-c]");
      if (!b) return;
      saveProfile({ theme: b.dataset.c });
      $("pfc").value = b.dataset.c.toLowerCase();
      mark(b.dataset.c);
    };
    $("pfc").oninput = (e) => {
      saveProfile({ theme: e.target.value });
      mark(e.target.value);
    };
    $("pfd").onclick = () => {
      saveProfile({ theme: "" });
      $("pfc").value = TFProfile.DEFAULT_THEME.toLowerCase();
      mark(TFProfile.DEFAULT_THEME);
    };
    $("pfo").onclick = signOutFlow;

    if (useCloud) {
      const paint = (s) => {
        const label = $("syl");
        if (!label) return;
        label.textContent =
          s.state === "synced"
            ? "Synced " + dj(s.at).format("h:mm A")
            : s.state === "syncing"
              ? "Syncing..."
              : s.state === "offline"
                ? "Offline. Changes will sync when you are back online."
                : s.state === "error"
                  ? "Could not sync: " + s.error
                  : "Waiting to sync";
      };
      paint(TFSync.status());
      const off = TFSync.onStatus(paint);
      cleanup = off;
      $("sys").onclick = () => TFSync.syncNow();
      $("pfs").onclick = async () => {
        const r = await TFAuth.updatePassword($("pfp").value);
        toast(r.ok ? "Password updated." : r.error);
        if (r.ok) $("pfp").value = "";
      };
    }
  }

  /** Remote changes arrive here from js/sync.js. */
  function applyRemote(change) {
    if (change.doc) Object.keys(change.doc).forEach((k) => (D[k] = change.doc[k]));
    if (change.boards) D.boards = change.boards;
    migrate();
    if (!D.boards.some((b) => b.id === D.boardCur) && D.boards.length) D.boardCur = D.boards[0].id;
    try {
      localStorage.setItem(DK, JSON.stringify(D));
    } catch (e) {
      /* storage full: the cloud still has everything */
    }
    renderNav();
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    const busy = cur === "notes" || cur === "board" || cur === "profile" || typing || $("md").innerHTML || $("emp");
    if (!busy) CAL ? CAL.refetchEvents() : V()[cur]();
  }

  /** Log out. Cloud accounts push any last changes first, then remove the local copy. */
  async function signOutFlow() {
    if (isGuest) {
      if (!confirm("Exit guest? Everything you made in this guest session will be deleted from this device.")) return;
      localStorage.removeItem(DK);
      localStorage.removeItem("tf_user");
      await idbClear();
      location.href = matchMedia("(display-mode: standalone)").matches ? "login.html" : "index.html";
      return;
    }
    if (useCloud) {
      if (!confirm("Log out? Your data is saved in your account and will be here when you sign back in on any device.")) return;
      toast("Saving your changes...");
      const result = await TFSync.flush();
      if (
        !result.ok &&
        !confirm("Some changes could not be uploaded yet (" + (result.error || "offline") + "). If you log out now they will be lost from this device. Log out anyway?")
      )
        return;
      TFSync.stop();
      TFSync.forget(user.id);
      await TFAuth.signOut();
      try {
        localStorage.removeItem(DK);
        TFProfile.clear(user.email);
      } catch (e) {
        /* nothing left to clear */
      }
      await idbClear();
    } else {
      if (!confirm("Log out? Your tasks, notes, whiteboards and history stay saved on this device, so everything will be exactly as you left it when you sign back in.")) return;
      localStorage.removeItem("tf_user");
    }
    location.href = matchMedia("(display-mode: standalone)").matches ? "login.html" : "index.html";
  }
  $("out").onclick = signOutFlow;
  document.addEventListener("tf-theme", () => {
    if (cur === "home" || cur === "timer") V()[cur]();
  });

  /* HELP */
  function help() {
    const yr = new Date().getFullYear(),
      gu = user.email === "guest";
    const faq = [
      [
        "Where is my data stored?",
        useCloud
          ? "In your TaskFlow account in the cloud, plus a copy on each device you use, so your work syncs between your phones and computers. Only you can read it. Guests and device-only accounts keep everything on this device."
          : "On this device, in your browser. TaskFlow does not upload your tasks, notes, drawings or history anywhere.",
      ],
      [
        "Will I lose my data?",
        useCloud
          ? "No. Your account keeps a copy in the cloud, so clearing a browser or changing phones does not lose it."
          : "Clearing your browser data removes it, and it cannot be recovered afterwards.",
      ],
      [
        "Does it work offline?",
        "Yes. After your first visit TaskFlow opens without internet.",
      ],
      [
        "How do I install the app?",
        "Use the Install app button in the sidebar or your browser menu. On iPhone use Share, then Add to Home Screen.",
      ],
      [
        "Will I get reminders when the app is closed?",
        "Reminders fire while TaskFlow is open, even in another tab. Installed on a supporting browser it also tries background reminders. Open Settings to enable notifications.",
      ],
    ];
    $("v").innerHTML =
      `<div class="in"><h1>Help &amp; privacy</h1><p class="sub">Your account, your data, and quick answers.</p>
<div class="panel"><h3>Account</h3><div class="acc"><span class="av">${$("av").innerHTML}</span><div><b>${esc(user.name)}</b><div class="dt">${gu ? "Guest session" : esc(user.email) + " &middot; " + (useCloud ? "Cloud account" : "Device account")}</div></div></div>
<div class="btns"><button class="btn d" id="del">${gu ? "Clear guest data" : "Delete account and data"}</button></div></div>
<h3 class="sec">Your data and privacy</h3><div class="panel"><ul>${useCloud ? "<li>Your data is stored in your account so it syncs across your devices. Only you can read it.</li>" : "<li>Everything you create is stored on this device only.</li>"}<li>No ads, no analytics and no tracking scripts.</li><li>Passwords are never stored in readable form.</li><li>You can delete all of it at any time.</li></ul></div>
<h3 class="sec">Frequently asked questions</h3>${faq.map((f) => `<details class="qa2"><summary>${f[0]}</summary><p>${f[1]}</p></details>`).join("")}
<p class="legal">&copy; ${yr} TaskFlow. All rights reserved.</p></div>`;
    $("del").onclick = async () => {
      const question = gu
        ? "Clear all guest data?"
        : useCloud
          ? "Delete your account and all your data, in the cloud and on this device? This cannot be undone."
          : "Delete your account and all data on this device? This cannot be undone.";
      if (!confirm(question)) return;
      if (useCloud) {
        try {
          TFSync.stop();
          const { error } = await TFCloud.client.rpc("delete_my_account");
          if (error) throw error;
          TFSync.forget(user.id);
          await TFAuth.signOut();
          TFProfile.clear(user.email);
        } catch (error) {
          toast("The account could not be deleted right now. " + TFCloud.friendly(error));
          TFSync.start({ uid: user.id, getData: () => D, apply: applyRemote });
          return;
        }
      }
      localStorage.removeItem(DK);
      if (!gu && !useCloud) {
        const u = JSON.parse(localStorage.getItem("tf_users") || "{}");
        delete u[user.email];
        localStorage.setItem("tf_users", JSON.stringify(u));
      }
      localStorage.removeItem("tf_user");
      await idbClear();
      location.href = gu ? "index.html" : "login.html";
    };
  }

  /* HOME */
  function home() {
    const h = new Date().getHours(),
      open = D.tasks.filter((t) => !t.done),
      k = today(),
      due = open.filter((t) => t.due === k).length,
      up = open
        .filter((t) => t.due)
        .sort((a, b) => dueMs(a) - dueMs(b))
        .slice(0, 5),
      nx = open.slice().sort(cmp).slice(0, 5),
      od = open.filter(overdue);
    $("v").innerHTML =
      `<div class="in"><div class="hero-card"><div><h1>${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}${user.email === "guest" ? "" : ", " + esc(user.name.split(" ")[0])}</h1><p class="sub">${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p><div class="btns"><button class="btn p" id="hn">${ic("plus")}New to-do</button><button class="btn" data-t="timer">${ic("timer")}Start focus</button></div></div>${IL.hero}</div>
${od.length ? `<button class="odstrip" id="odgo">${ic("bell")}<b>${od.length} to-do${od.length > 1 ? "s" : ""} overdue</b><span>${esc(od[0].text)}${od.length > 1 ? " and " + (od.length - 1) + " more" : ""} ${od.length > 1 ? "are" : "is"} past due and still not ticked off.</span>${ic("r")}</button>` : ""}
<div class="cards">${[
        ["check", open.length, "Open to-dos"],
        ["check", D.tasks.length - open.length, "Completed"],
        ["cal", due, "Due today"],
        ["note", D.notes.length, "Notes"],
      ]
        .map(
          (c) =>
            `<div class="st">${ic(c[0])}<b>${c[1]}</b><span>${c[2]}</span></div>`,
        )
        .join("")}</div>
<div class="two"><div class="panel"><h3>Completed this week</h3><div class="chw"><canvas id="c1"></canvas></div></div><div class="panel"><h3>Open to-dos by priority</h3><div class="chw" id="c2w"><canvas id="c2"></canvas></div></div></div>
<div class="two"><div><h3 class="sec">Up next</h3>${nx.map(miniRow).join("") || empty("tasks", "All clear", "Add a task to get started.")}</div><div><h3 class="sec">Coming up</h3>${up.map(miniRow).join("") || empty("cal", "Nothing scheduled", "Give a task a date and it shows here and in Calendar.")}</div></div></div>`;
    $("hn").onclick = () => openTask();
    const og = $("odgo");
    if (og) og.onclick = () => ((tf = "overdue"), go("tasks"));
    $("v")
      .querySelectorAll("[data-t]")
      .forEach((b) => (b.onclick = () => go(b.dataset.t)));
    $("v").onclick = (e) => {
      const r = e.target.closest("[data-open]");
      if (r) openTask(D.tasks.find((t) => t.id === r.dataset.open));
    };
    const w = last7();
    CH.push(
      new Chart($("c1"), {
        type: "bar",
        data: {
          labels: w.l,
          datasets: [
            {
              data: w.k.map(
                (d) =>
                  D.tasks.filter(
                    (t) => t.doneAt && dj(t.doneAt).format("YYYY-MM-DD") === d,
                  ).length,
              ),
              backgroundColor: accent(),
              borderRadius: 6,
              maxBarThickness: 30,
            },
          ],
        },
        options: chartOpts(),
      }),
    );
    const pc = Object.keys(PR).map((p) => open.filter((t) => t.p === p).length);
    if (pc.some(Boolean))
      CH.push(
        new Chart($("c2"), {
          type: "doughnut",
          data: {
            labels: Object.keys(PR).map((p) => PR[p].n),
            datasets: [
              {
                data: pc,
                backgroundColor: Object.keys(PR).map((p) => PR[p].c),
                borderWidth: 2,
                borderColor: "#fff",
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "62%",
            plugins: {
              legend: {
                position: "bottom",
                labels: { usePointStyle: true, boxWidth: 8 },
              },
            },
          },
        }),
      );
    else
      $("c2w").innerHTML = empty(
        "tasks",
        "No open to-dos",
        "Nothing to chart yet.",
      );
  }

  /* TASKS */
  let tf = "all",
    tpf = "all";
  /* NOTES (Tiptap) */
  let nid = null,
    ED = null;
  function notes() {
    const FONTS = [
      ["", "Sans", "'Plus Jakarta Sans', Inter, ui-sans-serif, system-ui, sans-serif"],
      ["'Lora', Georgia, serif", "Serif", "'Lora', Georgia, serif"],
      ["'JetBrains Mono', ui-monospace, Menlo, monospace", "Mono", "'JetBrains Mono', ui-monospace, monospace"],
      ["'Caveat', 'Segoe Print', cursive", "Handwriting", "'Caveat', cursive"],
    ];
    const TB = [
      ["bold", "bold", "Bold"],
      ["italic", "italic", "Italic"],
      ["underline", "underline", "Underline"],
      ["hl", "highlighter", "Highlight"],
      ["h1", "heading-1", "Heading 1"],
      ["h2", "heading-2", "Heading 2"],
      ["ul", "list", "Bullet list"],
      ["ol", "list-ordered", "Numbered list"],
      ["task", "list-checks", "Checklist"],
      ["quote", "quote", "Quote"],
      ["code", "code", "Code"],
      ["link", "link", "Link"],
      ["undo", "undo-2", "Undo"],
      ["redo", "redo-2", "Redo"],
    ];
    $("v").innerHTML =
      `<div class="notes" id="nw"><div class="nl"><button class="btn p" id="nn" style="width:100%;margin-bottom:8px;justify-content:center">${ic("plus")}New note</button><div id="nli"></div></div>
<div class="ne"><div class="nem">${IL.notes}<b>Select or create a note</b><span>Your notes are saved as you type.</span></div><div class="nb2"><div class="tb"><button class="btn sm back" id="nb">${ic("l")}Notes</button><select class="nfont" id="nfont" aria-label="Font" title="Font">${FONTS.map((f) => `<option value="${f[0]}" style="font-family:${f[2]}">${f[1]}</option>`).join("")}</select>${TB.map((b) => `<button class="tbb" data-a="${b[0]}" title="${b[2]}" aria-label="${b[2]}" onmousedown="event.preventDefault()">${ic(b[1])}</button>`).join("")}<span style="flex:1"></span><button class="btn sm p" id="nsave">Save</button><button class="btn sm" id="npdf" title="Download as PDF">${ic("down")}PDF</button></div>
<input class="nt" id="nt" placeholder="Untitled"><div id="ed" class="ed"></div><div class="wc" id="nwc"></div></div></div></div>`;
        const A = {
      bold: (c) => c.toggleBold(),
      italic: (c) => c.toggleItalic(),
      underline: (c) => c.toggleUnderline(),
      hl: (c) => c.toggleHighlight(),
      h1: (c) => c.toggleHeading({ level: 1 }),
      h2: (c) => c.toggleHeading({ level: 2 }),
      ul: (c) => c.toggleBulletList(),
      ol: (c) => c.toggleOrderedList(),
      task: (c) => c.toggleTaskList(),
      quote: (c) => c.toggleBlockquote(),
      code: (c) => c.toggleCodeBlock(),
      undo: (c) => c.undo(),
      redo: (c) => c.redo(),
    };
    const AC2 = {
      bold: ["bold"],
      italic: ["italic"],
      underline: ["underline"],
      hl: ["highlight"],
      h1: ["heading", { level: 1 }],
      h2: ["heading", { level: 2 }],
      ul: ["bulletList"],
      ol: ["orderedList"],
      task: ["taskList"],
      quote: ["blockquote"],
      code: ["codeBlock"],
      link: ["link"],
    };
    const act = () => {
      document.querySelectorAll(".tbb").forEach((b) => {
        const a = AC2[b.dataset.a];
        b.classList.toggle("on", !!(a && ED && ED.isActive(...a)));
      });
      if (!ED) return;
      const ff = ED.getAttributes("textStyle").fontFamily || "",
        sel = $("nfont");
      if (sel) sel.value = FONTS.some((f) => f[0] === ff) ? ff : "";
      const wc = $("nwc");
      if (wc) {
        const n = ED.storage.characterCount.words();
        wc.textContent = n + (n === 1 ? " word" : " words");
      }
    };
    const mk = (html) => {
      ED && ED.destroy();
      ED = new Tiptap.Editor({
        element: $("ed"),
        content: html || "",
        extensions: [
          Tiptap.StarterKit,
          Tiptap.Underline,
          Tiptap.Highlight,
          Tiptap.Link.configure({ openOnClick: false, autolink: true }),
          Tiptap.TaskList,
          Tiptap.TaskItem.configure({ nested: true }),
          Tiptap.TextStyle,
          Tiptap.FontFamily,
          Tiptap.CharacterCount,
          Tiptap.Placeholder.configure({ placeholder: "Start writing..." }),
        ],
        onUpdate: () => sv(),
        onTransaction: act,
      });
    };
    const list = () => {
      $("nli").innerHTML =
        D.notes
          .map(
            (n) =>
              `<div class="ni ${n.id === nid ? "on" : ""}" data-id="${n.id}">${ic("note")}<span>${esc(n.title || "Untitled")}</span><span class="nia"><button class="nib" data-a="edit" title="Edit note" aria-label="Edit note">${ic("pen")}</button><button class="nib" data-a="exp" title="Export note" aria-label="Export note">${ic("down")}</button><button class="nib d" data-a="del" title="Delete note" aria-label="Delete note">${ic("trash")}</button></span></div>`,
          )
          .join("") ||
        empty("notes", "No notes yet", "Create a note to start writing.");
    };
    const open = (id) => {
      nid = id;
      const n = D.notes.find((x) => x.id === id);
      $("nt").value = n ? n.title : "";
      mk(n ? n.body : "");
      $("nw").classList.toggle("edit", !!n);
      list();
    };
    const sv = () => {
      const n = D.notes.find((x) => x.id === nid);
      if (!n) return;
      n.title = $("nt").value;
      n.body = ED.getHTML();
      n.at = Date.now();
      save();
      list();
    };
    $("nn").onclick = () => {
      const n = { id: uid(), title: "", body: "", at: Date.now() };
      D.notes.unshift(n);
      log("note", "Created a new note");
      save();
      open(n.id);
      $("nt").focus();
    };
    $("nli").onclick = (e) => {
      const a = e.target.closest("[data-a]"),
        i = e.target.closest(".ni");
      if (!i) return;
      const id = i.dataset.id;
      if (a) {
        const k = a.dataset.a;
        if (k === "edit") open(id);
        else if (k === "exp") expNote(id);
        else if (k === "del") delNote(id);
        return;
      }
      open(id);
    };
    $("nt").oninput = sv;
    $("nb").onclick = () => {
      nid = null;
      $("nw").classList.remove("edit");
      list();
    };
    const delNote = (id) => {
      const gone = D.notes.find((n) => n.id === id);
      if (!gone || !confirm('Delete "' + (gone.title || "Untitled") + '"?'))
        return;
      D.notes = D.notes.filter((n) => n.id !== id);
      D.trash.unshift({ k: "note", at: Date.now(), item: gone });
      if (D.trash.length > 60) D.trash.length = 60;
      log("note", 'Deleted note "' + (gone.title || "Untitled") + '"');
      save();
      if (nid === id) {
        nid = null;
        $("nt").value = "";
        mk("");
        $("nw").classList.remove("edit");
      }
      list();
    };
    $("nsave").onclick = () => {
      if (!nid || !D.notes.find((x) => x.id === nid))
        return toast("Select a note first.");
      sv();
      toast("Saved. Your note stays in the app on this device.");
    };
    const noteFile = (id) => {
      const n = D.notes.find((x) => x.id === id);
      if (!n) return null;
      if (id === nid) sv();
      const title = String(n.title || "").trim() || "Untitled note",
        base = slug(title, "note"),
        css = "body{font-family:'Plus Jakarta Sans',Inter,ui-sans-serif,-apple-system,\"Segoe UI\",Roboto,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.7;color:#16140f}h1{letter-spacing:-.03em}blockquote{border-left:3px solid #F97316;padding-left:14px;color:#55534e}code{background:#f7f7f5;padding:2px 5px;border-radius:4px}li{margin:3px 0}ul[data-type=\"taskList\"]{list-style:none;padding-left:2px}ul[data-type=\"taskList\"] li{display:flex;gap:8px;align-items:flex-start}ul[data-type=\"taskList\"] input{margin-top:4px}";
      return {
        n,
        title,
        base,
        html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body><h1>${esc(title)}</h1>${n.body || ""}</body></html>`,
      };
    };
    const expNote = (id) => {
      const f = noteFile(id);
      if (!f) return toast("Select a note first.");
      dlFile(f.html, f.base + ".html", "text/html;charset=utf-8");
      log("note", 'Exported note "' + f.title + '"');
      save();
      toast("Note exported to your device files");
    };
    const pdfNote = (id) => {
      const f = noteFile(id);
      if (!f) return toast("Select a note first.");
      printDoc(f.html);
      log("note", 'Downloaded "' + f.title + '" as PDF');
      save();
      toast('Choose "Save as PDF" in the print dialog');
    };
    $("npdf").onclick = () => pdfNote(nid);
    $("nfont").onchange = (e) => {
      if (!nid || !ED) return;
      const c = ED.chain().focus();
      (e.target.value ? c.setFontFamily(e.target.value) : c.unsetFontFamily()).run();
    };
    document.querySelector(".tb").onclick = (e) => {
      const b = e.target.closest(".tbb");
      if (!b || !nid || !ED) return;
      const a = b.dataset.a;
      if (a === "link") {
        const u = prompt("Link address (leave empty to remove)", "https://");
        if (u === null) return;
        const c = ED.chain().focus().extendMarkRange("link");
        (u && u !== "https://" ? c.setLink({ href: u }) : c.unsetLink()).run();
      } else A[a](ED.chain().focus()).run();
    };
    mk("");
    list();
    cleanup = () => {
      ED && ED.destroy();
      ED = null;
    };
    open(
      D.notes.find((n) => n.id === nid)
        ? nid
        : innerWidth > 820 && D.notes[0]
          ? D.notes[0].id
          : null,
    );
  }

  /* CALENDAR (FullCalendar): to-dos with dates, focus sessions, quick add, drag to time-block */
  let CAL = null,
    calRefresh = null,
    calView = "timeGridWeek";
  const calLayers = { todo: true, focus: true, done: true };
  function cal() {
    const mob = innerWidth < 700;
    if (mob && calView === "timeGridWeek") calView = "timeGridDay";
    let mini = dj().startOf("month");
    $("v").innerHTML = `<div class="gcal"><aside class="gc-side"><button class="btn p gc-new" id="gcn">${ic("plus")}New</button>
<div class="gc-mh"><b id="gcmt"></b><span><button class="ib" id="gcmp" aria-label="Previous month">${ic("l")}</button><button class="ib" id="gcmn" aria-label="Next month">${ic("r")}</button></span></div><div id="gcm"></div>
<h4>Layers</h4>${[["todo", "To-dos", "#F97316"], ["focus", "Focus sessions", "#16140f"], ["done", "Completed", "#b9b4a8"]].map((l) => `<label class="gcl"><input type="checkbox" data-k="${l[0]}" ${calLayers[l[0]] ? "checked" : ""}><i style="--c:${l[2]}"></i>${l[1]}</label>`).join("")}
<h4>Unscheduled</h4><div id="gcu"></div></aside>
<section class="gc-main"><div class="gc-top"><button class="btn" id="gct">Today</button><button class="ib" id="gcp" aria-label="Previous">${ic("l")}</button><button class="ib" id="gcx" aria-label="Next">${ic("r")}</button><h2 id="gch"></h2><select class="inp sel" id="gcv" aria-label="View">${[["timeGridDay", "Day"], ["timeGridWeek", "Week"], ["dayGridMonth", "Month"], ["listWeek", "Agenda"]].map((v) => `<option value="${v[0]}" ${v[0] === calView ? "selected" : ""}>${v[1]}</option>`).join("")}</select></div><div id="fc"></div></section></div>`;
    const drawMini = () => {
      $("gcmt").textContent = mini.format("MMMM YYYY");
      const first = mini.startOf("week"), cur = CAL ? dj(CAL.getDate()).format("YYYY-MM-DD") : today();
      let h = "SMTWTFS".split("").map((d) => `<i class="mh">${d}</i>`).join("");
      for (let i = 0; i < 42; i++) {
        const d = first.add(i, "day"), k = d.format("YYYY-MM-DD");
        h += `<button class="md ${d.month() !== mini.month() ? "o" : ""} ${k === today() ? "td" : ""} ${k === cur ? "sl" : ""}" data-d="${k}">${d.date()}</button>`;
      }
      $("gcm").innerHTML = h;
    };
    const drawUns = () => {
      const u = D.tasks.filter((t) => !t.done && t.my === today() && !t.time);
      $("gcu").innerHTML = u.map((t) => `<div class="ud" data-id="${t.id}" data-title="${esc(t.text)}">${esc(t.text)}${t.est ? `<small>${fmtMin(t.est)}</small>` : ""}</div>`).join("") + (u.length ? '<p class="hint">Drag one onto the calendar to give it a time.</p>' : '<p class="hint">Add to-dos to My Day, then drag them here to plan your day.</p>');
    };
    const events = (info, ok) => {
      const out = [];
      if (calLayers.todo || calLayers.done)
        D.tasks.filter((t) => t.due && (t.done ? calLayers.done : calLayers.todo)).forEach((t) => out.push({ id: t.id, title: (t.emo ? t.emo + " " : "") + t.text, start: t.due + (t.time ? "T" + t.time : ""), allDay: !t.time, end: t.time && t.est ? dj(t.due + "T" + t.time).add(t.est, "minute").toISOString() : undefined, extendedProps: { p: t.p, done: t.done } }));
      if (calLayers.focus)
        D.focus.forEach((f, i) => out.push({ id: "f" + i, title: "Focus " + f.min + " min", start: new Date(f.at - f.min * 6e4), end: new Date(f.at), editable: false, extendedProps: { focus: true } }));
      ok(out);
    };
    let pop = null;
    const closePop = () => pop && (pop.remove(), (pop = null));
    const quickAdd = (dateStr, allDay, jsEvent) => {
      closePop();
      const day = dateStr.slice(0, 10), time = allDay ? "" : dateStr.slice(11, 16);
      pop = document.createElement("div");
      pop.className = "qpop";
      pop.innerHTML = `<input class="inp" id="qt" placeholder="Add title" autocomplete="off"><div class="mut" style="font-size:12.5px;margin:6px 0 8px">${dj(day).format("ddd, MMM D")}${time ? ", " + t12(time) : ""}</div><div class="btns"><button class="btn sm p" id="qs">Save</button><button class="btn sm" id="qm">More options</button></div>`;
      document.body.appendChild(pop);
      const x = Math.min(jsEvent.clientX, innerWidth - 270), y = Math.min(jsEvent.clientY, innerHeight - 150);
      pop.style.left = Math.max(8, x) + "px";
      pop.style.top = Math.max(8, y) + "px";
      $("qt").focus();
      const save1 = (more) => {
        const text = $("qt").value.trim();
        if (more) {
          closePop();
          return openTask({ text, due: day, time });
        }
        if (!text) return $("qt").focus();
        D.tasks.unshift({ id: uid(), text, desc: "", p: "med", due: day, time, rem: true, done: false, at: Date.now(), list: "", my: "", repeat: "", est: 0, spent: 0, steps: [], notified: !time || dueMs({ due: day, time }) - D.set.lead * 6e4 <= Date.now() });
        log("task", 'Added to-do "' + text + '"');
        save();
        closePop();
        CAL.refetchEvents();
        drawUns();
      };
      $("qs").onclick = () => save1(false);
      $("qm").onclick = () => save1(true);
      $("qt").onkeydown = (e) => e.key === "Enter" && save1(false);
    };
    const mapView = (v) => v;
    CAL = new FullCalendar.Calendar($("fc"), {
      initialView: calView, headerToolbar: false, height: "100%", nowIndicator: true, editable: true, droppable: true, dayMaxEvents: 3,
      scrollTime: "07:00:00", eventTimeFormat: { hour: "numeric", minute: "2-digit", meridiem: "short" }, events,
      datesSet: (i) => { $("gch").textContent = i.view.title; drawMini(); },
      dateClick: (i) => quickAdd(i.dateStr, i.allDay, i.jsEvent),
      eventClick: (i) => { i.jsEvent.preventDefault(); const t = D.tasks.find((x) => x.id === i.event.id); if (t) openTask(t); },
      eventDrop: (i) => {
        const t = D.tasks.find((x) => x.id === i.event.id);
        if (!t) return;
        t.due = dj(i.event.start).format("YYYY-MM-DD");
        t.time = i.event.allDay ? "" : dj(i.event.start).format("HH:mm");
        t.notified = dueMs(t) - D.set.lead * 6e4 <= Date.now();
        log("task", 'Rescheduled "' + t.text + '" to ' + dueLabel(t));
        save();
      },
      drop: (i) => {
        const t = D.tasks.find((x) => x.id === i.draggedEl.dataset.id);
        if (!t) return;
        t.due = i.dateStr.slice(0, 10);
        t.time = i.allDay ? "" : i.dateStr.slice(11, 16);
        t.notified = dueMs(t) - D.set.lead * 6e4 <= Date.now();
        log("task", 'Scheduled "' + t.text + '" for ' + dueLabel(t));
        save();
        CAL.refetchEvents();
        drawUns();
        toast("Scheduled for " + dueLabel(t) + ".");
      },
      eventReceive: (i) => i.event.remove(),
      eventClassNames: (a) => a.event.extendedProps.focus ? ["focus"] : ["p-" + a.event.extendedProps.p, a.event.extendedProps.done ? "is-done" : ""],
    });
    CAL.render();
    drawUns();
    calRefresh = () => { drawUns(); drawMini(); };
    new FullCalendar.Draggable($("gcu"), { itemSelector: ".ud", eventData: (el) => ({ title: el.dataset.title, create: false }) });
    $("gct").onclick = () => CAL.today();
    $("gcp").onclick = () => CAL.prev();
    $("gcx").onclick = () => CAL.next();
    $("gcv").onchange = (e) => { calView = mapView(e.target.value); CAL.changeView(calView); };
    $("gcn").onclick = () => openTask({ due: today() });
    $("gcmp").onclick = () => ((mini = mini.subtract(1, "month")), drawMini());
    $("gcmn").onclick = () => ((mini = mini.add(1, "month")), drawMini());
    $("gcm").onclick = (e) => { const b = e.target.closest("[data-d]"); if (b) { CAL.gotoDate(b.dataset.d); drawMini(); } };
    $("v").querySelectorAll("[data-k]").forEach((c) => (c.onchange = () => ((calLayers[c.dataset.k] = c.checked), CAL.refetchEvents())));
    const outside = (e) => pop && !pop.contains(e.target) && closePop();
    document.addEventListener("pointerdown", outside, true);
    cleanup = () => { document.removeEventListener("pointerdown", outside, true); closePop(); CAL && CAL.destroy(); CAL = null; calRefresh = null; };
  }

  /* WHITEBOARD (Fabric.js vector canvas) — side panel lists every board (file) the user created */
  function board() {
    const PAL = ["#191919", "#F97316", "#2563eb", "#16a34a", "#dc2626", "#9333ea"];
    const TOOLS = [
      ["select", "mouse-pointer-2", "Select (V)"],
      ["hand", "hand", "Pan (H)"],
      ["pen", "pencil", "Pen (P)"],
      ["line", "minus", "Line (L)"],
      ["rect", "square", "Rectangle (R)"],
      ["ellipse", "circle", "Ellipse (O)"],
      ["text", "type", "Text (T)"],
      ["fill", "paint-bucket", "Fill (F)"],
      ["erase", "eraser", "Eraser (E)"],
    ];
    const CUR = { pen: "crosshair", line: "crosshair", rect: "crosshair", ellipse: "crosshair", text: "text", fill: "copy", erase: "cell", hand: "grab" };
    const gu = user.email === "guest";
    let tool = "select", stroke = PAL[0], fillc = "", width = 3;
    let cv = null, hist = [], hi = -1, restoring = false, drawing = false, erasing = false;
    let shape = null, origin = null, panFrom = null, spaceDown = false, saveT = 0, saveId = "", ro = null;
    const curB = () => D.boards.find((b) => b.id === D.boardCur) || D.boards[0];
    const isConn = (o) => !!(o && o.tf);
    const isFree = (o) => !!(o && o instanceof fabric.Path && !o.tf);
    const isTxt = (o) => !!(o && o instanceof fabric.IText);
    $("v").innerHTML =
      `<div class="wbw" id="wbw"><aside class="wbp" aria-label="Saved whiteboards"><div class="wbh"><b>My whiteboards</b><button class="btn sm p" id="wbn">${ic("plus")}New</button></div><div class="wbl" id="wbl"></div><p class="wbnote">${gu ? "Guest boards live on this device and are removed when you exit guest mode." : "Boards are saved on this device and stay here, even when you sign out."}</p></aside>
<div class="wbm"><div class="wbt wbt1" role="toolbar" aria-label="Whiteboard tools"><button class="btn sm back" id="wbb">${ic("l")}Boards</button>
<div class="tg" id="wtl">${TOOLS.map((t) => `<button class="tbb ${t[0] === "select" ? "on" : ""}" data-tool="${t[0]}" title="${t[2]}" aria-label="${t[2]}">${ic(t[1])}</button>`).join("")}</div><span class="vr"></span>
<div class="tg" id="wsw"><span class="tl">Stroke</span>${PAL.map((c, i) => `<button class="sw ${i ? "" : "on"}" data-s="${c}" style="background:${c}" aria-label="Stroke colour ${c}"></button>`).join("")}<label class="sw cust" title="Custom stroke colour"><input type="color" id="wsc" value="#191919" aria-label="Custom stroke colour"></label></div>
<div class="tg" id="wfw"><span class="tl">Fill</span><button class="sw none on" data-f="" title="No fill" aria-label="No fill"></button>${PAL.map((c) => `<button class="sw" data-f="${c}" style="background:${c}" aria-label="Fill colour ${c}"></button>`).join("")}<label class="sw cust" title="Custom fill colour"><input type="color" id="wfc" value="#fde68a" aria-label="Custom fill colour"></label></div>
<div class="tg"><input type="range" id="sz" min="1" max="24" value="3" aria-label="Line width"><output id="szv">3</output></div><span class="vr"></span>
<div class="tg"><button class="tbb" id="wbundo" title="Undo (Ctrl+Z)" aria-label="Undo">${ic("undo-2")}</button><button class="tbb" id="wbredo" title="Redo (Ctrl+Y)" aria-label="Redo">${ic("redo-2")}</button><button class="tbb" id="zo" title="Zoom out" aria-label="Zoom out">${ic("zoom-out")}</button><button class="zl" id="zl" title="Reset zoom">100%</button><button class="tbb" id="zi" title="Zoom in" aria-label="Zoom in">${ic("zoom-in")}</button></div><span class="sp"></span>
<button class="btn sm d" id="cl">Clear</button><button class="btn sm p" id="wbsave">Save</button></div>
<div class="cvw-sel"><div class="wsel" id="wsel" hidden><b id="wst">Selected</b><button class="btn sm" id="wsstr" title="Make this a straight line">${ic("minus")}Straight</button><button class="btn sm" id="wscur" title="Turn this stroke into a smooth curve">${ic("spline")}Curve</button><label class="wsl" id="wsbl">Bend<input type="range" id="wbend" min="-100" max="100" value="0" aria-label="Line bend"></label><button class="btn sm" id="wsdash">Dashed</button><button class="btn sm" id="wsdup">${ic("copy")}Duplicate</button><button class="btn sm d" id="wsdel">${ic("trash")}Delete</button></div></div>
<div class="cvw"><div class="cv" id="cv"><canvas id="c"></canvas></div></div></div></div>`;
    /* ---------- boards panel ---------- */
    const panel = () => {
      $("wbl").innerHTML =
        D.boards.map((b) => `<div class="wbi ${b.id === D.boardCur ? "on" : ""}" data-id="${b.id}" tabindex="0" role="button" aria-label="Open ${esc(b.title)}">${b.img ? `<img class="wbth" src="${b.img}" alt="">` : `<span class="wbth ph">${ic("pen")}</span>`}<span class="wbtx"><b>${esc(b.title)}</b><small>${b.up || b.at ? dshort(b.up || b.at) : "Empty"}</small></span><span class="nia"><button class="nib" data-a="edit" title="Rename board" aria-label="Rename board">${ic("pen")}</button><button class="nib" data-a="exp" title="Export PNG" aria-label="Export PNG">${ic("down")}</button><button class="nib" data-a="pdf" title="Download as PDF" aria-label="Download as PDF">${ic("note")}</button><button class="nib d" data-a="del" title="Delete board" aria-label="Delete board">${ic("trash")}</button></span></div>`).join("") ||
        `<div class="empty" style="border:0">${IL.notes}<b>No whiteboards yet</b><span>Create one with New.</span></div>`;
    };
    /* ---------- fabric setup ---------- */
    const wrap = $("cv");
    Object.assign(fabric.FabricObject.ownDefaults, { transparentCorners: false, cornerColor: "#ffffff", cornerStrokeColor: accent(), borderColor: accent(), cornerStyle: "circle", cornerSize: 11, padding: 4, perPixelTargetFind: true, borderScaleFactor: 1.5 });
    cv = new fabric.Canvas("c", { backgroundColor: "#ffffff", preserveObjectStacking: true, selectionColor: "rgba(249,115,22,.08)", selectionBorderColor: "#F97316", selectionLineWidth: 1, perPixelTargetFind: true, targetFindTolerance: 8, stopContextMenu: true, fireRightClick: false, enableRetinaScaling: true });
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        cv.setDimensions({ width: Math.floor(r.width), height: Math.floor(r.height) });
        cv.requestRenderAll();
      }
    };
    fit();
    ro = new ResizeObserver(fit);
    ro.observe(wrap);
    /* ---------- helpers ---------- */
    const connPath = (t) => {
      const dx = t.x2 - t.x1, dy = t.y2 - t.y1, len = Math.hypot(dx, dy) || 1, b = (t.bend / 100) * len;
      if (!t.bend) return `M ${t.x1} ${t.y1} L ${t.x2} ${t.y2}`;
      const cx = (t.x1 + t.x2) / 2 + (-dy / len) * b, cy = (t.y1 + t.y2) / 2 + (dx / len) * b;
      return `M ${t.x1} ${t.y1} Q ${cx} ${cy} ${t.x2} ${t.y2}`;
    };
    const mkConn = (t, st) => {
      const p = new fabric.Path(connPath(t), Object.assign({ fill: "", stroke, strokeWidth: width, strokeLineCap: "round", objectCaching: false, hasControls: false, lockScalingX: true, lockScalingY: true, lockRotation: true, hoverCursor: "move" }, st || {}));
      const m = p.calcTransformMatrix();
      p.tf = { x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, bend: t.bend, cx: m[4], cy: m[5] };
      return p;
    };
    /* keep a line's endpoints in step with where the user dragged it */
    const syncConn = () => cv.getObjects().forEach((o) => {
      if (!o.tf) return;
      const m = o.calcTransformMatrix(), dx = m[4] - o.tf.cx, dy = m[5] - o.tf.cy;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        o.tf.x1 += dx; o.tf.y1 += dy; o.tf.x2 += dx; o.tf.y2 += dy; o.tf.cx = m[4]; o.tf.cy = m[5];
      }
    });
    const snap = () => { syncConn(); return JSON.stringify(cv.toObject(["tf"])); };
    const flags = () => cv.forEachObject((o) => {
      o.selectable = tool === "select";
      o.evented = true;
      o.perPixelTargetFind = tool !== "fill";
    });
    const toolUI = () => {
      document.querySelectorAll("#wtl [data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === tool));
    };
    const setTool = (t) => {
      tool = t;
      cv.isDrawingMode = t === "pen";
      cv.selection = t === "select";
      cv.skipTargetFind = t === "hand";
      cv.perPixelTargetFind = t !== "fill";
      cv.defaultCursor = CUR[t] || "default";
      cv.hoverCursor = t === "select" ? "move" : CUR[t] || "default";
      cv.freeDrawingCursor = "crosshair";
      if (t === "pen") {
        const b = new fabric.PencilBrush(cv);
        b.color = stroke; b.width = width; b.decimate = 2;
        cv.freeDrawingBrush = b;
      }
      if (t !== "select") cv.discardActiveObject();
      flags(); toolUI(); selUI(); cv.requestRenderAll();
    };
    /* ---------- undo / redo / persistence ---------- */
    const undoUI = () => {
      $("wbundo").disabled = hi <= 0;
      $("wbredo").disabled = hi >= hist.length - 1;
    };
    const exportFrom = (c, maxW) => {
      const os = c.getObjects();
      if (!os.length) return null;
      let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      const vpt = c.viewportTransform.slice();
      c.setViewportTransform([1, 0, 0, 1, 0, 0]);
      try {
        os.forEach((o) => {
          const r = o.getBoundingRect();
          x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.left + r.width); y2 = Math.max(y2, r.top + r.height);
        });
        const pad = 24, w = x2 - x1 + pad * 2, h = y2 - y1 + pad * 2;
        const m = maxW ? Math.min(1, maxW / w) : Math.min(2, 4000 / Math.max(w, h));
        return c.toDataURL({ format: "png", left: x1 - pad, top: y1 - pad, width: w, height: h, multiplier: m, enableRetinaScaling: false });
      } finally {
        c.setViewportTransform(vpt);
        c.requestRenderAll && c.requestRenderAll();
      }
    };
    const flush = () => {
      if (!saveT) return;
      clearTimeout(saveT); saveT = 0;
      const b = D.boards.find((x) => x.id === saveId);
      if (!b || !cv || saveId !== D.boardCur) return;
      b.json = hist[hi];
      b.img = exportFrom(cv, 260) || "";
      b.up = Date.now();
      panel(); save();
    };
    const persist = () => { saveId = D.boardCur; clearTimeout(saveT); saveT = setTimeout(flush, 600); };
    const commit = () => {
      if (restoring || drawing) return;
      const j = snap();
      if (j === hist[hi]) return;
      hist = hist.slice(0, hi + 1); hist.push(j);
      if (hist.length > 40) hist.shift();
      hi = hist.length - 1;
      undoUI(); persist();
    };
    const restore = async (j) => {
      restoring = true;
      try { await cv.loadFromJSON(j); } catch (e) { toast("Could not restore that step."); }
      restoring = false; flags(); cv.discardActiveObject(); cv.requestRenderAll(); selUI(); undoUI(); persist();
    };
    const undo = () => { if (hi > 0) { hi--; restore(hist[hi]); } };
    const redo = () => { if (hi < hist.length - 1) { hi++; restore(hist[hi]); } };
    const zoomUI = () => { $("zl").textContent = Math.round(cv.getZoom() * 100) + "%"; };
    const loadB = async (b) => {
      restoring = true;
      cv.clear(); cv.backgroundColor = "#ffffff";
      try {
        if (b.json) await cv.loadFromJSON(b.json);
        else if (b.img) {
          const im = await fabric.FabricImage.fromURL(b.img), k = 1 / (devicePixelRatio || 1);
          im.set({ left: 0, top: 0, scaleX: k, scaleY: k });
          cv.add(im);
        }
      } catch (e) { toast("Could not open this board."); }
      restoring = false;
      cv.setViewportTransform([1, 0, 0, 1, 0, 0]);
      flags(); hist = [snap()]; hi = 0; cv.discardActiveObject(); cv.requestRenderAll(); undoUI(); zoomUI(); selUI();
    };
    /* ---------- selection bar (straighten / curve / dash ...) ---------- */
    function selUI() {
      const objs = cv ? cv.getActiveObjects() : [];
      $("wsel").hidden = !objs.length;
      if (!objs.length) return;
      const o = objs[0], one = objs.length === 1, conn = one && isConn(o), free = one && isFree(o), txt = one && isTxt(o);
      $("wst").textContent = conn ? "Line" : free ? "Drawing" : txt ? "Text" : one ? "Shape" : objs.length + " items";
      $("wsstr").hidden = !(conn || free);
      $("wscur").hidden = !free;
      $("wsbl").hidden = !conn;
      $("wsdash").hidden = txt;
      if (conn) $("wbend").value = o.tf.bend;
    }
    const repl = (o, n) => {
      cv.remove(o); cv.add(n); flags();
      cv.setActiveObject(n); cv.requestRenderAll(); selUI();
    };
    const ends = (o) => {
      const m = o.calcTransformMatrix(), po = o.pathOffset, pts = [];
      o.path.forEach((c) => {
        const n = c.length;
        if (n >= 3) pts.push(fabric.util.transformPoint(new fabric.Point(c[n - 2] - po.x, c[n - 1] - po.y), m));
      });
      return pts;
    };
    const toConn = (o, curve) => {
      const pts = ends(o);
      if (pts.length < 2) return;
      const a = pts[0], z = pts[pts.length - 1], dx = z.x - a.x, dy = z.y - a.y, len = Math.hypot(dx, dy) || 1;
      let bend = 0;
      if (curve) {
        let best = 0;
        pts.forEach((p) => { const d = ((p.x - a.x) * -dy + (p.y - a.y) * dx) / len; if (Math.abs(d) > Math.abs(best)) best = d; });
        bend = Math.max(-100, Math.min(100, ((2 * best) / len) * 100));
      }
      repl(o, mkConn({ x1: a.x, y1: a.y, x2: z.x, y2: z.y, bend }, { stroke: o.stroke, strokeWidth: o.strokeWidth, strokeDashArray: o.strokeDashArray }));
      commit();
    };
    $("wsstr").onclick = () => {
      const o = cv.getActiveObject();
      if (isFree(o)) toConn(o, false);
      else if (isConn(o)) { const n = mkConn(Object.assign({}, o.tf, { bend: 0 }), { stroke: o.stroke, strokeWidth: o.strokeWidth, strokeDashArray: o.strokeDashArray }); repl(o, n); $("wbend").value = 0; commit(); }
    };
    $("wscur").onclick = () => { const o = cv.getActiveObject(); if (isFree(o)) toConn(o, true); };
    $("wbend").oninput = (e) => {
      const o = cv.getActiveObject();
      if (!isConn(o)) return;
      drawing = true;
      repl(o, mkConn(Object.assign({}, o.tf, { bend: +e.target.value }), { stroke: o.stroke, strokeWidth: o.strokeWidth, strokeDashArray: o.strokeDashArray }));
    };
    $("wbend").onchange = () => { drawing = false; commit(); };
    $("wsdash").onclick = () => {
      cv.getActiveObjects().forEach((o) => { if (!isTxt(o)) o.set("strokeDashArray", o.strokeDashArray ? null : [o.strokeWidth * 2 + 2, o.strokeWidth * 2 + 2]); });
      cv.requestRenderAll(); commit();
    };
    const del = () => {
      const os = cv.getActiveObjects();
      if (!os.length) return;
      cv.discardActiveObject();
      drawing = true; os.forEach((o) => cv.remove(o)); drawing = false;
      cv.requestRenderAll(); commit();
    };
    $("wsdel").onclick = del;
    const dup = async () => {
      const os = cv.getActiveObjects();
      if (!os.length) return;
      cv.discardActiveObject();
      const out = [];
      for (const o of os) {
        const c = await o.clone(["tf"]);
        c.set({ left: o.left + 18, top: o.top + 18 });
        if (c.tf) { c.tf.x1 += 18; c.tf.y1 += 18; c.tf.x2 += 18; c.tf.y2 += 18; c.tf.cx += 18; c.tf.cy += 18; }
        drawing = true; cv.add(c); drawing = false; out.push(c);
      }
      flags();
      cv.setActiveObject(out.length === 1 ? out[0] : new fabric.ActiveSelection(out, { canvas: cv }));
      cv.requestRenderAll(); commit();
    };
    $("wsdup").onclick = dup;
    /* ---------- colours & width (apply to the selection too) ---------- */
    const mark = (sel, v, attr) => document.querySelectorAll(sel).forEach((b) => b.classList.toggle("on", b.dataset[attr] === v));
    const setStroke = (c) => {
      stroke = c; mark("#wsw .sw[data-s]", c, "s");
      if (tool === "pen") cv.freeDrawingBrush.color = c;
      cv.getActiveObjects().forEach((o) => o.set(isTxt(o) ? "fill" : "stroke", c));
      cv.requestRenderAll(); if (cv.getActiveObjects().length) commit();
    };
    const setFill = (c) => {
      fillc = c; mark("#wfw .sw[data-f]", c, "f");
      cv.getActiveObjects().forEach((o) => { if (!isConn(o) && !isTxt(o)) o.set("fill", c || "transparent"); });
      cv.requestRenderAll(); if (cv.getActiveObjects().length) commit();
    };
    $("wsw").onclick = (e) => { const b = e.target.closest("[data-s]"); if (b) setStroke(b.dataset.s); };
    $("wfw").onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) setFill(b.dataset.f); };
    $("wsc").oninput = (e) => setStroke(e.target.value);
    $("wfc").oninput = (e) => setFill(e.target.value);
    $("sz").oninput = (e) => {
      width = +e.target.value; $("szv").textContent = width;
      if (tool === "pen") cv.freeDrawingBrush.width = width;
      cv.getActiveObjects().forEach((o) => { if (!isTxt(o)) o.set("strokeWidth", width); });
      cv.requestRenderAll();
    };
    $("sz").onchange = () => { if (cv.getActiveObjects().length) commit(); };
    $("wtl").onclick = (e) => { const b = e.target.closest("[data-tool]"); if (b) setTool(b.dataset.tool); };
    /* ---------- drawing tools ---------- */
    const clampZoom = (z) => Math.max(0.2, Math.min(4, z));
    const zoomBy = (f, p) => {
      const c = p || new fabric.Point(cv.getWidth() / 2, cv.getHeight() / 2);
      cv.zoomToPoint(c, clampZoom(cv.getZoom() * f)); zoomUI();
    };
    $("zi").onclick = () => zoomBy(1.2);
    $("zo").onclick = () => zoomBy(1 / 1.2);
    $("zl").onclick = () => { cv.setViewportTransform([1, 0, 0, 1, 0, 0]); zoomUI(); cv.requestRenderAll(); };
    cv.on("mouse:wheel", (o) => {
      const e = o.e; e.preventDefault(); e.stopPropagation();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) zoomBy(0.999 ** e.deltaY, new fabric.Point(e.offsetX, e.offsetY));
    });
    const eraseAt = (t) => { if (t) { drawing = true; cv.remove(t); drawing = false; cv.requestRenderAll(); } };
    cv.on("mouse:down", (o) => {
      const e = o.e, pt = cv.getScenePoint(e);
      if (tool === "hand" || spaceDown || e.button === 1) { panFrom = { x: e.clientX, y: e.clientY }; cv.setCursor("grabbing"); return; }
      if (tool === "line" || tool === "rect" || tool === "ellipse") {
        drawing = true; origin = pt;
        const st = { stroke, strokeWidth: width, selectable: false, evented: false, objectCaching: false };
        if (tool === "line") shape = new fabric.Line([pt.x, pt.y, pt.x, pt.y], Object.assign({ strokeLineCap: "round" }, st));
        else if (tool === "rect") shape = new fabric.Rect(Object.assign({ left: pt.x, top: pt.y, width: 0, height: 0, rx: 6, ry: 6, fill: fillc || "transparent" }, st));
        else shape = new fabric.Ellipse(Object.assign({ left: pt.x, top: pt.y, rx: 0, ry: 0, fill: fillc || "transparent" }, st));
        cv.add(shape);
      } else if (tool === "text") {
        const t = new fabric.IText("Text", { left: pt.x, top: pt.y, fontFamily: "'Plus Jakarta Sans', Inter, system-ui, sans-serif", fontSize: Math.max(20, width * 6 + 12), fill: stroke });
        setTool("select"); cv.add(t); flags(); cv.setActiveObject(t); t.enterEditing(); t.selectAll(); cv.requestRenderAll();
      } else if (tool === "fill") {
        const t = [...cv.getObjects()].reverse().find((x) => !isConn(x) && !isTxt(x) && x.containsPoint(pt));
        if (t) t.set("fill", fillc || "transparent"); else cv.backgroundColor = fillc || "#ffffff";
        cv.requestRenderAll(); commit();
      } else if (tool === "erase") { erasing = true; drawing = true; eraseAt(o.target); }
    });
    cv.on("mouse:move", (o) => {
      const e = o.e;
      if (panFrom) {
        const v = cv.viewportTransform; v[4] += e.clientX - panFrom.x; v[5] += e.clientY - panFrom.y;
        panFrom = { x: e.clientX, y: e.clientY }; cv.setViewportTransform(v); return;
      }
      if (erasing) { eraseAt(o.target); return; }
      if (!shape) return;
      const p = cv.getScenePoint(e);
      let dx = p.x - origin.x, dy = p.y - origin.y;
      if (tool === "line") {
        if (e.shiftKey) { const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12), d = Math.hypot(dx, dy); dx = Math.cos(a) * d; dy = Math.sin(a) * d; }
        shape.set({ x2: origin.x + dx, y2: origin.y + dy });
      } else {
        if (e.shiftKey) { const s = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * s; dy = Math.sign(dy || 1) * s; }
        const l = Math.min(origin.x, origin.x + dx), t = Math.min(origin.y, origin.y + dy);
        if (tool === "rect") shape.set({ left: l, top: t, width: Math.abs(dx), height: Math.abs(dy) });
        else shape.set({ left: l, top: t, rx: Math.abs(dx) / 2, ry: Math.abs(dy) / 2 });
      }
      shape.setCoords(); cv.requestRenderAll();
    });
    cv.on("mouse:up", () => {
      if (panFrom) { panFrom = null; cv.setCursor(CUR[tool] || "default"); return; }
      if (erasing) { erasing = false; drawing = false; commit(); return; }
      if (!shape) return;
      const s = shape; shape = null;
      const tiny = tool === "line" ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 4 : tool === "rect" ? s.width < 4 && s.height < 4 : s.rx < 3 && s.ry < 3;
      cv.remove(s);
      if (!tiny) {
        if (tool === "line") cv.add(mkConn({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, bend: 0 }));
        else { s.set({ evented: true, selectable: false }); cv.add(s); }
      }
      drawing = false; flags(); cv.requestRenderAll(); commit();
    });
    cv.on("path:created", (e) => { e.path.set({ fill: "", strokeLineCap: "round", strokeLineJoin: "round" }); commit(); });
    cv.on("object:added", (e) => { if (!restoring) { e.target.selectable = tool === "select"; e.target.perPixelTargetFind = tool !== "fill"; } if (!drawing) commit(); });
    cv.on("object:modified", commit);
    cv.on("editing:exited", commit);
    ["selection:created", "selection:updated", "selection:cleared"].forEach((n) => cv.on(n, selUI));
    /* ---------- keyboard ---------- */
    const KEYS = { v: "select", h: "hand", p: "pen", l: "line", r: "rect", o: "ellipse", t: "text", f: "fill", e: "erase" };
    const kd = (e) => {
      if (cur !== "board" || !cv) return;
      const tg = e.target;
      if (/INPUT|TEXTAREA|SELECT/.test(tg.tagName) || tg.isContentEditable) return;
      const ao = cv.getActiveObject();
      if (ao && ao.isEditing) return;
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (k === " ") { e.preventDefault(); if (!spaceDown) { spaceDown = true; cv.skipTargetFind = true; cv.selection = false; cv.setCursor("grab"); } return; }
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === "y") { e.preventDefault(); redo(); return; }
      if (mod && k === "d") { e.preventDefault(); dup(); return; }
      if (k === "delete" || k === "backspace") { e.preventDefault(); del(); return; }
      if (!mod && !e.altKey && KEYS[k]) setTool(KEYS[k]);
    };
    const ku = (e) => { if (e.key === " " && spaceDown) { spaceDown = false; cv.skipTargetFind = tool === "hand"; cv.selection = tool === "select"; cv.setCursor(CUR[tool] || "default"); } };
    addEventListener("keydown", kd); addEventListener("keyup", ku);
    /* ---------- boards: open / new / rename / export / delete ---------- */
    const openB = async (id) => {
      const b = D.boards.find((x) => x.id === id);
      if (!b) return;
      flush();
      D.boardCur = b.id; panel(); save();
      await loadB(b);
      if (innerWidth <= 820) { $("wbw").classList.add("edit"); fit(); }
    };
    panel();
    if (innerWidth <= 820) $("wbw").classList.add("edit");
    loadB(curB()).then(() => setTool("select"));
    $("wbl").onclick = (e) => {
      const i = e.target.closest(".wbi");
      if (!i) return;
      const id = i.dataset.id, a = e.target.closest("[data-a]");
      if (a) {
        const k = a.dataset.a;
        if (k === "edit") rename(id); else if (k === "exp") pngB(id); else if (k === "pdf") pdfB(id); else if (k === "del") delB(id);
        return;
      }
      openB(id);
    };
    $("wbl").onkeydown = (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest(".nib")) return;
      const i = e.target.closest(".wbi");
      if (i) { e.preventDefault(); openB(i.dataset.id); }
    };
    $("wbn").onclick = async () => {
      flush();
      const b = { id: uid(), title: "Board " + (D.boards.length + 1), img: "", at: Date.now() };
      D.boards.unshift(b); D.boardCur = b.id;
      log("board", 'Created whiteboard "' + b.title + '"');
      panel(); save();
      await loadB(b);
      if (innerWidth <= 820) { $("wbw").classList.add("edit"); fit(); }
      toast("New whiteboard created.");
    };
    const rename = (id) => {
      const b = D.boards.find((x) => x.id === id) || curB();
      if (!b) return;
      const t = prompt("Whiteboard name", b.title);
      if (t === null) return;
      const n = t.trim().slice(0, 60);
      if (!n) return toast("A board needs a name.");
      b.title = n; log("board", 'Renamed a whiteboard to "' + n + '"'); panel(); save();
    };
    /* a PNG of any board: the live canvas for the open one, an offscreen render for the others */
    const pngOf = async (id) => {
      const b = D.boards.find((x) => x.id === id);
      if (!b) return null;
      if (id === D.boardCur) return exportFrom(cv);
      if (!b.json) return b.img || null;
      const sc = new fabric.StaticCanvas(null, { width: 1200, height: 800, backgroundColor: "#ffffff" });
      try { await sc.loadFromJSON(b.json); return exportFrom(sc); } finally { sc.dispose(); }
    };
    const pngB = async (id) => {
      const b = D.boards.find((x) => x.id === id), url = await pngOf(id);
      if (!b || !url) return toast("This board is empty.");
      const a = document.createElement("a");
      a.href = url; a.download = slug(b.title, "whiteboard") + ".png"; a.click();
      log("board", 'Exported whiteboard "' + b.title + '" as image'); save();
      toast("Whiteboard exported to your device files");
    };
    const pdfB = async (id) => {
      const b = D.boards.find((x) => x.id === id), url = await pngOf(id);
      if (!b || !url) return toast("This board is empty.");
      const title = b.title;
      printDoc(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{margin:14mm}body{font-family:'Plus Jakarta Sans',Inter,ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:#16140f;margin:0}h1{font-size:20px;letter-spacing:-.03em;margin:0 0 14px}img{max-width:100%;height:auto}</style></head><body><h1>${esc(title)}</h1><img src="${url}" alt=""></body></html>`);
      log("board", 'Downloaded "' + title + '" as PDF'); save();
      toast('Choose "Save as PDF" in the print dialog');
    };
    const delB = async (id) => {
      const b = D.boards.find((x) => x.id === id);
      if (!b || !confirm('Delete board "' + b.title + '"?')) return;
      flush();
      D.boards = D.boards.filter((x) => x.id !== b.id);
      if (!D.boards.length) D.boards.push({ id: uid(), title: "Board 1", img: "", at: Date.now() });
      const reopen = D.boardCur === b.id;
      if (reopen) D.boardCur = D.boards[0].id;
      log("board", 'Deleted whiteboard "' + b.title + '"');
      panel(); save();
      if (reopen) await loadB(curB());
      toast("Whiteboard deleted.");
    };
    $("wbundo").onclick = undo;
    $("wbredo").onclick = redo;
    $("wbb").onclick = () => { flush(); $("wbw").classList.remove("edit"); };
    $("wbsave").onclick = () => {
      saveId = D.boardCur; saveT = saveT || 1; flush();
      const b = curB(); if (b && !b.json) { b.json = snap(); b.up = Date.now(); save(); }
      log("board", "Saved the whiteboard"); save();
      toast("Whiteboard saved. It will be here when you come back.");
    };
    $("cl").onclick = () => {
      if (!confirm("Clear the whole board?")) return;
      restoring = true; cv.clear(); cv.backgroundColor = "#ffffff"; restoring = false;
      cv.requestRenderAll(); selUI(); commit();
      log("board", "Cleared the whiteboard"); save();
    };
    cleanup = () => {
      removeEventListener("keydown", kd); removeEventListener("keyup", ku);
      ro && ro.disconnect();
      if (saveT) { saveId = saveId || D.boardCur; flush(); }
      try { cv.dispose(); } catch (e) { /* already gone */ }
      cv = null;
    };
  }

  /* TIMER */
  const T = { end: 0, left: 0, total: 0, run: false, iv: null, kind: "focus" };
  const fmt = (s) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  function tick() {
    const l = Math.max(0, Math.round((T.end - Date.now()) / 1000));
    T.left = l;
    paint();
    if (l <= 0) stopT(true);
  }
  function paint() {
    const s = fmt(T.left);
    $("fb").textContent = s;
    $("fp").style.width = (T.total ? 100 - (T.left / T.total) * 100 : 0) + "%";
    document.title = T.total ? `${s} \u00b7 TaskFlow` : "TaskFlow - Workspace";
    const b = $("tb");
    if (b) b.textContent = s;
  }
  let aw;
  function wake() {
    const f = $("fs");
    f.classList.add("awake");
    clearTimeout(aw);
    aw = setTimeout(() => f.classList.remove("awake"), 2500);
  }
  ["mousemove", "pointerdown", "touchstart", "keydown"].forEach((e) =>
    $("fs").addEventListener(e, wake, { passive: true }),
  );
  addEventListener(
    "keydown",
    () => $("fs").classList.contains("show") && wake(),
  );
  function startT(min, kind, todo) {
    ac();
    T.kind = kind;
    T.todo = todo || "";
    T.total = T.left = Math.round(min * 60);
    T.end = Date.now() + T.left * 1000;
    T.run = true;
    clearInterval(T.iv);
    T.iv = setInterval(tick, 500);
    $("fpause").textContent = "Pause";
    $("fs").classList.add("show");
    document.documentElement.requestFullscreen &&
      document.documentElement.requestFullscreen().catch(() => {});
    wake();
    paint();
  }
  /* done = the countdown reached zero. Stopping early still logs the whole
     minutes already focused, so the graph reflects real work. */
  function stopT(done) {
    const full = Math.round(T.total / 60),
      left = T.run ? Math.max(0, Math.round((T.end - Date.now()) / 1000)) : T.left,
      spent = done ? full : Math.floor((T.total - left) / 60),
      word = T.kind === "focus" ? "focus" : "break";
    if (done) {
      log("timer", "Completed a " + full + " min " + word + " session");
      if (T.kind === "focus") D.focus.push({ at: Date.now(), min: full, todo: T.todo || "" });
        addSpent(T.todo, full);
      save();
    } else if (T.total && spent >= 1) {
      log("timer", "Stopped a " + word + " session after " + spent + " min");
      if (T.kind === "focus") {
        D.focus.push({ at: Date.now(), min: spent, part: 1, todo: T.todo || "" });
        addSpent(T.todo, spent);
        toast("Logged " + spent + " min of focus.");
      }
      save();
    }
    clearInterval(T.iv);
    T.run = false;
    T.total = 0;
    exitFs();
    $("fs").classList.remove("show");
    document.title = "TaskFlow - Workspace";
    if (done) {
      chime(3);
      notify(
        "Time is up",
        "Your " + full + " minute " + (T.kind === "focus" ? "focus session" : "break") + " is complete.",
        "timer",
      );
    }
    if (cur === "timer") timer();
  }
  function exitFs() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  $("fpause").onclick = () => {
    if (T.run) {
      T.run = false;
      clearInterval(T.iv);
      T.left = Math.max(0, Math.round((T.end - Date.now()) / 1000));
      $("fpause").textContent = "Resume";
    } else {
      T.end = Date.now() + T.left * 1000;
      T.run = true;
      T.iv = setInterval(tick, 500);
      $("fpause").textContent = "Pause";
    }
    paint();
  };
  $("fstop").onclick = () => stopT(false);
  $("fexit").onclick = () => {
    exitFs();
    $("fs").classList.remove("show");
  };
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") $("fs").classList.remove("show");
  });
  function timer() {
    const m = D.timer.mode,
      kd = D.timer.kind === "break" ? "break" : "focus",
      rg = D.timer.range === "4w" ? "4w" : "7d",
      pr = [
        [25, "focus", "Focus 25"],
        [50, "focus", "Focus 50"],
        [5, "break", "Break 5"],
        [15, "break", "Break 15"],
      ],
      fm = (n) => (n >= 60 ? Math.floor(n / 60) + "h " + (n % 60) + "m" : n + " min"),
      dayMin = (d) => D.focus.filter((f) => dj(f.at).format("YYYY-MM-DD") === d).reduce((a, f) => a + f.min, 0),
      w = last7(),
      mins = w.k.map(dayMin),
      weeks = [3, 2, 1, 0].map((i) => {
        const a = dj().startOf("week").subtract(i, "week"),
          b = a.add(7, "day");
        return {
          l: i === 0 ? "This week" : a.format("MMM D"),
          v: D.focus.filter((f) => f.at >= a.valueOf() && f.at < b.valueOf()).reduce((s, f) => s + f.min, 0),
        };
      }),
      weekTotal = mins.reduce((a, b) => a + b, 0),
      sessions = D.focus.filter((f) => f.at >= dj().subtract(6, "day").startOf("day").valueOf()).length;
    let streak = 0;
    for (let i = 0; i < 400; i++) {
      const d = dj().subtract(i, "day").format("YYYY-MM-DD");
      if (dayMin(d) > 0) streak++;
      else if (i > 0) break;
    }
    $("v").innerHTML =
      `<div class="in tm"><h1>Focus timer</h1><p class="sub">Press start and the timer fills your screen. Move the mouse to show the controls.</p><div class="pills">${pr.map((p) => `<button class="btn ${p[0] === m && p[1] === kd ? "on" : ""}" data-m="${p[0]}" data-k="${p[1]}">${p[2]}</button>`).join("")}</div>
<div class="big" id="tb">${fmt(T.total && T.run ? T.left : m * 60)}</div><div class="pills"><button class="btn p" id="ts" style="padding:11px 26px;font-size:16px">${T.total ? "Open full screen" : "Start"}</button><input class="inp" id="tc" type="number" min="1" max="600" placeholder="Custom min" aria-label="Custom minutes" style="width:140px"><select class="inp sel" id="tk" aria-label="Session type"><option value="focus" ${kd === "focus" ? "selected" : ""}>Focus</option><option value="break" ${kd === "break" ? "selected" : ""}>Break</option></select></div>
<div class="panel tstat"><div class="tsh"><h3>Focus time</h3><div class="seg" role="tablist" aria-label="Range"><button class="${rg === "7d" ? "on" : ""}" data-r="7d" role="tab">7 days</button><button class="${rg === "4w" ? "on" : ""}" data-r="4w" role="tab">4 weeks</button></div></div>
<div class="tsg"><div><b>${fm(mins[6])}</b><span>Today</span></div><div><b>${fm(weekTotal)}</b><span>Last 7 days</span></div><div><b>${sessions}</b><span>Sessions</span></div><div><b>${streak}${streak ? " \u{1F525}" : ""}</b><span>Day streak</span></div></div>
<div class="chw"><canvas id="c3" role="img" aria-label="Focus minutes chart"></canvas></div></div></div>`;
    $("v").querySelectorAll("[data-m]").forEach(
      (b) =>
        (b.onclick = () => {
          D.timer.mode = +b.dataset.m;
          D.timer.kind = b.dataset.k;
          save();
          timer();
        }),
    );
    $("v").querySelectorAll("[data-r]").forEach(
      (b) =>
        (b.onclick = () => {
          D.timer.range = b.dataset.r;
          save();
          timer();
        }),
    );
    $("tk").onchange = (e) => {
      D.timer.kind = e.target.value;
      save();
      timer();
    };
    $("tc").onchange = (e) => {
      const v = Math.min(600, Math.max(1, +e.target.value || 0));
      if (v) {
        D.timer.mode = v;
        save();
        timer();
      }
    };
    $("ts").onclick = () => {
      if (T.total) {
        $("fs").classList.add("show");
        document.documentElement.requestFullscreen &&
          document.documentElement.requestFullscreen().catch(() => {});
        wake();
        return;
      }
      startT(D.timer.mode, kd);
    };
    /* Re-rendering the timer view must not stack Chart instances on
       detached canvases; if Chart.js failed to load, say so politely. */
    killCh();
    if (!window.Chart) {
      $("c3").parentElement.innerHTML =
        '<p class="sub" style="margin:0">Charts could not load. Check your connection and reload the app.</p>';
      return;
    }
    const labels = rg === "7d" ? w.l : weeks.map((x) => x.l),
      data = rg === "7d" ? mins : weeks.map((x) => x.v),
      last = data.length - 1;
    CH.push(
      new Chart($("c3"), {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              data,
              backgroundColor: data.map((_, i) => (i === last ? accent() : "#16140f")),
              hoverBackgroundColor: data.map((_, i) => (i === last ? accent2() : "#3b372f")),
              borderRadius: 6,
              maxBarThickness: 34,
              minBarLength: 0,
            },
          ],
        },
        options: Object.assign(chartOpts(), {
          scales: {
            y: {
              beginAtZero: true,
              suggestedMax: 30,
              ticks: { precision: 0, callback: (v) => v + "m" },
              grid: { color: "#eeece7" },
            },
            x: { grid: { display: false } },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              displayColors: false,
              callbacks: { label: (c) => fm(c.parsed.y || 0) + " focused" },
            },
          },
        }),
      }),
    );
    if (!data.some(Boolean))
      $("c3").insertAdjacentHTML(
        "afterend",
        '<p class="chn">No focus time logged yet. Start a session and this fills in.</p>',
      );
  }

  /* SETTINGS */
  function settings() {
    const s = D.set,
      st = !canN()
        ? "Not supported in this browser"
        : Notification.permission === "granted"
          ? "Allowed"
          : Notification.permission === "denied"
            ? "Blocked in browser settings"
            : "Not enabled yet";
    const sw = (id, on, l, d) =>
      `<label class="srow"><span><b>${l}</b><small>${d}</small></span><input type="checkbox" class="swc" id="${id}" ${on ? "checked" : ""}></label>`;
    $("v").innerHTML =
      `<div class="in"><h1>Settings</h1><p class="sub">Reminders and sound.</p>
<div class="panel"><h3>Notifications</h3><p class="dt" style="margin:-6px 0 12px">Status: <b id="ns">${st}</b></p><div class="btns"><button class="btn p" id="ne">${ic("bell")}Enable notifications</button><button class="btn" id="nt2">Send a test</button></div></div>
<h3 class="sec">Reminders</h3><div class="panel">${sw("s1", s.remind, "Task reminders", "Alert me when a task with a date and time is due.")}${sw("s7", s.nag, "Nag me about missed tasks", "Keep reminding me about a task that is due and still not ticked off: 3 snoozes of 5 minutes (15 minutes in total), then once an hour for up to 3 days.")}
<label class="srow"><span><b>Remind me</b><small>How early to alert you.</small></span><select class="inp sel" id="s2">${[
        [0, "At due time"],
        [5, "5 minutes before"],
        [10, "10 minutes before"],
        [15, "15 minutes before"],
        [30, "30 minutes before"],
        [60, "1 hour before"],
      ]
        .map(
          (o) =>
            `<option value="${o[0]}" ${o[0] === s.lead ? "selected" : ""}>${o[1]}</option>`,
        )
        .join("")}</select></label>
${sw("s3", s.daily, "Daily reminder to work", "A nudge each day with your open to-dos.")}<label class="srow"><span><b>Reminder time</b><small>When the daily reminder appears.</small></span><input class="inp sel" id="s4" value="${s.dailyAt}" style="width:130px"></label></div>
<h3 class="sec">Sound</h3><div class="panel">${sw("s5", s.sound, "Play a sound", "Chime when a timer ends or a reminder fires.")}<div class="btns" style="margin-top:10px"><button class="btn" id="s6">${ic("bell")}Play sound</button></div></div>
<p class="legal" style="text-align:left;margin-top:18px">Reminders fire while TaskFlow is open, including in another tab or minimised window. Installed on a supporting browser, TaskFlow also tries to remind you in the background. Reliable delivery when the app is fully closed on every device needs a push server, which this offline app does not have.</p></div>`;
    const set = (k, v) => {
      D.set[k] = v;
      save();
    };
    $("s1").onchange = (e) => set("remind", e.target.checked);
    $("s7").onchange = (e) => {
      set("nag", e.target.checked);
      if (e.target.checked) checkAlerts();
    };
    $("s2").onchange = (e) => set("lead", +e.target.value);
    $("s3").onchange = (e) => set("daily", e.target.checked);
    $("s5").onchange = (e) => set("sound", e.target.checked);
    const fp = flatpickr("#s4", {
      enableTime: true,
      noCalendar: true,
      dateFormat: "H:i",
      altInput: true,
      altFormat: "h:i K",
      altInputClass: "inp sel",
      disableMobile: true,
      onChange: (_, v) => {
        if (v) {
          D.set.dailyAt = v;
          D.set.lastDaily = "";
          save();
        }
      },
    });
    cleanup = () => fp.destroy();
    $("ne").onclick = async () => {
      const r = await askPerm();
      $("ns").textContent =
        r === "granted"
          ? "Allowed"
          : r === "denied"
            ? "Blocked in browser settings"
            : r === "unsupported"
              ? "Not supported in this browser"
              : "Not enabled yet";
    };
    $("nt2").onclick = async () => {
      await askPerm();
      notify("TaskFlow test", "Reminders are working.", "test");
    };
    $("s6").onclick = () => {
      ac();
      chime(1);
    };
  }

  const lu = () => window.lucide && lucide.createIcons();
  let lr;
  new MutationObserver(() => {
    cancelAnimationFrame(lr);
    lr = requestAnimationFrame(lu);
  }).observe(document.body, { childList: true, subtree: true });
  lu();
  $("sbtn").onclick = openSearch;
  const paintDark = () => {
    const on = document.documentElement.classList.contains("dark");
    $("dkbtn").innerHTML = ic(on ? "sun" : "moon");
    $("dkbtn").setAttribute("aria-pressed", String(on));
  };
  $("dkbtn").onclick = () => {
    const on = document.documentElement.classList.toggle("dark");
    localStorage.setItem("tf_dark", on ? "1" : "0");
    paintDark();
  };
  paintDark();
  setInterval(checkRem, 15000);
  setInterval(checkAlerts, 20000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      checkRem();
      checkAlerts();
    }
  });
  idbGet("fired").then((f) => {
    if (f) {
      D.tasks.forEach((t) => {
        if (f[t.id]) t.notified = true;
      });
    }
  });
  setTimeout(() => {
    checkRem();
    checkAlerts();
    syncSW();
    if (canN() && Notification.permission === "granted") regPeriodic();
  }, 1500);
  if (useCloud) {
    TFCloud.getSession().then(async (session) => {
      if (!session) {
        localStorage.removeItem("tf_user");
        location.replace("login.html");
        return;
      }
      user.id = session.user.id;
      TFSync.start({ uid: user.id, getData: () => D, apply: applyRemote });
      try {
        profile = await TFProfile.sync(user.email, user.id, user.name);
        if (profile.name) user.name = profile.name;
        paintIdentity();
      } catch (error) {
        /* the cached profile is already on screen */
      }
    });
  }
  go(
    TABS.some((t) => t[0] === location.hash.slice(1))
      ? location.hash.slice(1)
      : "home",
  );
})();
