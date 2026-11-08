/**
 * Sign in / sign up page controller.
 *
 * Two bits of state drive the whole page, both stored as data attributes on <body>
 * so the stylesheet can react to them:
 *   data-view  "intro" (phone welcome screen) or "form"
 *   data-mode  "signin", "signup", "forgot" (ask for a reset email) or "reset" (choose a new password)
 * All account logic lives in js/auth.js (window.TFAuth).
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const isDesktop = window.matchMedia("(min-width: 960px)");
  const hasHover = window.matchMedia("(hover: hover)");
  const cloud = TFAuth.mode === "cloud";

  /** Every piece of text that changes between the modes. */
  const COPY = Object.freeze({
    signin: {
      title: "Welcome back",
      lede: "Sign in to open your workspace.",
      pitch: "Welcome <em>back!</em>",
      pitchText: "Pick up where you left off. Your tasks, notes and focus time are waiting.",
      submit: "Sign in",
      switchText: "Don't have an account?",
      switchLabel: "Sign up",
      switchTo: "signup",
      passwordLabel: "Password",
      passwordPlaceholder: "Enter your password",
      autocomplete: "current-password",
    },
    signup: {
      title: "Get started",
      lede: cloud
        ? "Create your free workspace. It syncs to every device you sign in on."
        : "Create your free workspace in seconds.",
      pitch: "Let's <em>get started</em>",
      pitchText: cloud
        ? "Plan, write and focus in one calm workspace. Your data follows you to every device."
        : "Plan, write and focus in one calm workspace. Free, fast and private.",
      submit: "Create account",
      switchText: "Already have an account?",
      switchLabel: "Sign in",
      switchTo: "signin",
      passwordLabel: "Password",
      passwordPlaceholder: `At least ${TFAuth.minPassword} characters`,
      autocomplete: "new-password",
    },
    forgot: {
      title: "Reset password",
      lede: "Enter your email and we'll send you a link to choose a new password.",
      pitch: "No <em>worries!</em>",
      pitchText: "It happens to everyone. A reset link will be in your inbox in a moment.",
      submit: "Send reset link",
      switchText: "Remembered it?",
      switchLabel: "Sign in",
      switchTo: "signin",
      passwordLabel: "Password",
      passwordPlaceholder: "",
      autocomplete: "current-password",
    },
    reset: {
      title: "Choose a new password",
      lede: "Pick something you haven't used before.",
      pitch: "Almost <em>there!</em>",
      pitchText: "Set a new password and you'll be signed straight in.",
      submit: "Update password",
      switchText: "",
      switchLabel: "",
      switchTo: "signin",
      passwordLabel: "New password",
      passwordPlaceholder: `At least ${TFAuth.minPassword} characters`,
      autocomplete: "new-password",
    },
  });

  const STRENGTH_HINTS = [
    `Use ${TFAuth.minPassword} or more characters with letters and numbers.`,
    "Too weak. Add more characters.",
    "Fair. Add numbers or capitals.",
    "Good. Almost there.",
    "Strong password.",
  ];

  /** Form-control wrappers by the field names TFAuth reports back. */
  const FIELD_BOXES = {
    name: $("f-name"),
    email: $("f-email"),
    password: $("f-password"),
    agree: $("f-agree"),
  };

  const currentMode = () => body.dataset.mode;

  /* ---------- feedback ---------- */

  function clearAlert() {
    $("alert").hidden = true;
    Object.values(FIELD_BOXES).forEach((box) => box.classList.remove("bad"));
  }

  function showInfo(message) {
    $("info").textContent = message;
    $("info").hidden = !message;
  }

  /**
   * Show an error above the button and highlight the field it belongs to.
   * @param {string} message
   * @param {string} [field] one of the keys of FIELD_BOXES
   */
  function showAlert(message, field) {
    clearAlert();
    showInfo("");
    const alert = $("alert");
    alert.textContent = message;
    alert.hidden = false;
    alert.classList.remove("shake");
    void alert.offsetWidth; // restart the shake animation
    alert.classList.add("shake");
    const box = FIELD_BOXES[field];
    if (box) {
      box.classList.add("bad");
      const control = box.querySelector("input");
      if (control) control.focus();
    }
  }

  function setBusy(busy) {
    $("submit").disabled = busy;
    $("submit").classList.toggle("loading", busy);
  }

  /* ---------- mode and view ---------- */

  function updateStrength() {
    const mode = currentMode();
    const choosing = mode === "signup" || mode === "reset";
    const score = choosing ? TFAuth.passwordScore($("password").value) : 0;
    $("meter").dataset.score = String(score);
    if (choosing) $("hint").textContent = STRENGTH_HINTS[score];
  }

  function setMode(mode) {
    const text = COPY[mode];
    const asksPassword = mode === "signin" || mode === "signup" || mode === "reset";
    const choosesPassword = mode === "signup" || mode === "reset";
    body.dataset.mode = mode;

    $("title").textContent = text.title;
    $("lede").textContent = text.lede;
    document.querySelector(".pitch h1").innerHTML = text.pitch; // static strings above, never user input
    document.querySelector(".pitch p").textContent = text.pitchText;
    $("submit-label").textContent = text.submit;
    $("switch-text").textContent = text.switchText;
    $("switch").textContent = text.switchLabel;
    $("switch").dataset.to = text.switchTo;
    $("password-label").textContent = text.passwordLabel;
    $("password").placeholder = text.passwordPlaceholder;
    $("password").autocomplete = text.autocomplete;
    document.title = `TaskFlow - ${text.title}`;

    FIELD_BOXES.name.hidden = mode !== "signup";
    FIELD_BOXES.email.hidden = mode === "reset";
    FIELD_BOXES.password.hidden = !asksPassword;
    $("meter").hidden = !choosesPassword;
    $("hint").hidden = !choosesPassword;
    $("row-signin").hidden = mode !== "signin";
    $("row-signup").hidden = mode !== "signup";
    $("forgot-note").hidden = true;
    $("forgot").setAttribute("aria-expanded", "false");
    $("divider").hidden = mode === "forgot" || mode === "reset";
    document.querySelector(".social").hidden = mode === "forgot" || mode === "reset";
    $("switch").parentElement.hidden = mode === "reset";

    clearAlert();
    showInfo("");
    updateStrength();
  }

  /** The form card is hidden from keyboards and screen readers while the welcome screen is up. */
  function syncSheetAccess() {
    $("sheet").inert = body.dataset.view === "intro" && !isDesktop.matches;
  }

  function firstField() {
    const mode = currentMode();
    return mode === "signup" ? "name" : mode === "reset" ? "password" : "email";
  }

  function setView(view) {
    body.dataset.view = view;
    syncSheetAccess();
    if (view === "form" && hasHover.matches) setTimeout(() => $(firstField()).focus(), 450);
  }

  /** Move from the phone welcome screen to the form, adding a history entry so the Back button returns. */
  function openForm(mode) {
    setMode(mode);
    if (!isDesktop.matches && !(history.state && history.state.view === "form")) {
      history.pushState({ view: "form" }, "");
    }
    setView("form");
  }

  /* ---------- events ---------- */

  $("goin").addEventListener("click", () => openForm("signin"));
  $("goup").addEventListener("click", () => openForm("signup"));
  $("switch").addEventListener("click", () => setMode($("switch").dataset.to));

  $("back").addEventListener("click", (event) => {
    if (!isDesktop.matches && body.dataset.view === "form") {
      event.preventDefault();
      history.state && history.state.view === "form" ? history.back() : setView("intro");
    }
  });
  window.addEventListener("popstate", () => {
    if (!isDesktop.matches) setView("intro");
  });
  isDesktop.addEventListener("change", () => {
    if (isDesktop.matches) body.dataset.view = "form";
    syncSheetAccess();
  });

  $("eye").addEventListener("click", () => {
    const reveal = $("password").type === "password";
    $("password").type = reveal ? "text" : "password";
    $("eye").setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    $("eye").setAttribute("aria-pressed", String(reveal));
    $("eye-open").hidden = reveal;
    $("eye-shut").hidden = !reveal;
    $("password").focus();
  });

  $("forgot").addEventListener("click", () => {
    if (cloud) {
      setMode("forgot");
      setTimeout(() => $("email").focus(), 50);
      return;
    }
    const note = $("forgot-note");
    note.hidden = !note.hidden;
    $("forgot").setAttribute("aria-expanded", String(!note.hidden));
  });

  $("password").addEventListener("input", updateStrength);
  ["name", "email", "password"].forEach((id) =>
    $(id).addEventListener("input", () => {
      if (!$("alert").hidden) clearAlert();
    }),
  );
  $("agree").addEventListener("change", () => FIELD_BOXES.agree.classList.remove("bad"));

  /** Go to the app after a successful sign-in, or explain what went wrong. */
  function finish(result) {
    if (result.ok) {
      $("submit-label").textContent = "Welcome!";
      location.assign("app.html");
      return;
    }
    setBusy(false);
    showAlert(result.error, result.field);
  }

  async function submitForm() {
    const mode = currentMode();
    const email = $("email").value;
    const password = $("password").value;

    if (mode === "signup") {
      const result = await TFAuth.signUp({
        email,
        password,
        name: $("name").value,
        agree: $("agree").checked,
      });
      if (result.ok && result.confirm) {
        setBusy(false);
        setMode("signin");
        $("email").value = email.trim();
        showInfo(`Almost there! We sent a confirmation link to ${email.trim()}. Open it, then sign in.`);
        return;
      }
      return finish(result);
    }

    if (mode === "forgot") {
      const result = await TFAuth.resetPassword(email);
      setBusy(false);
      if (!result.ok) return showAlert(result.error, result.field);
      showInfo(
        `If ${email.trim()} has an account, a reset link is on its way. It can take a minute to arrive.`,
      );
      return;
    }

    if (mode === "reset") {
      const result = await TFAuth.updatePassword(password);
      if (!result.ok) return finish(result);
      await TFAuth.adoptCloudSession(true);
      return finish({ ok: true });
    }

    return finish(await TFAuth.signIn({ email, password, remember: $("remember").checked }));
  }

  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(true);
    clearAlert();
    showInfo("");
    try {
      await submitForm();
    } catch (error) {
      setBusy(false);
      showAlert("Something went wrong. Please try again.");
    }
  });

  /* ---------- start up ---------- */

  async function start() {
    $("year").textContent = new Date().getFullYear();
    const lastEmail = TFAuth.lastEmail();
    if (lastEmail) $("email").value = lastEmail;

    // Arriving from an email link: a confirmation signs the person in, a recovery link asks for a new password.
    const arrival = window.TFCloud ? window.TFCloud.arrival : "";
    if (cloud && arrival && arrival !== "recovery" && (await TFAuth.adoptCloudSession(true))) {
      location.replace("app.html");
      return;
    }
    if (TFAuth.isSignedIn() && arrival !== "recovery") {
      location.replace("app.html");
      return;
    }

    const requested = new URLSearchParams(location.search).get("mode");
    const recovering = cloud && (arrival === "recovery" || requested === "reset");
    setMode(recovering ? "reset" : requested === "signup" ? "signup" : "signin");
    // Phones open on the welcome screen unless the link already says what the person wants to do.
    const direct = recovering || requested;
    setView(isDesktop.matches || direct ? "form" : "intro");
    if (!isDesktop.matches && direct) history.replaceState({ view: "form" }, "");
    if (recovering) TFAuth.onRecovery(() => setMode("reset"));

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  }

  start();
})();
