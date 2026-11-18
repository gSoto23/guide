/**
 * The guest guide's only script (feature 004 contracts/guide-web.md, budget 15 KB gzip). Pages
 * work without it except Show code and the confirmation form. It reads its strings from the
 * page's JSON data block, never from a bundled catalog, and never stores a locked value.
 */
type Texts = Record<string, string>;

interface Session {
  state: "public" | "before" | "inside" | "ended";
  stay?: {
    checkInDate: string;
    checkoutDate: string;
    checkInTime: string | null;
    checkoutTime: string | null;
  };
  opensAt?: string;
  timeZone?: string;
  codeRequired: boolean;
  verified: boolean;
  lockedUntil: string | null;
}

const root = document.documentElement;
const publicId = root.dataset.publicId ?? "";
const lang = root.lang || "es";
const textsBlock = document.getElementById("guest-texts");
const texts: Texts = textsBlock ? (JSON.parse(textsBlock.textContent ?? "{}") as Texts) : {};
const HIDE_AFTER_MS = 5 * 60 * 1000;
let session: Session | null = null;

function text(key: string, values: Record<string, string | number> = {}): string {
  return (texts[key] ?? "").replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  content?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

async function api(path: string, body?: object): Promise<Response> {
  return fetch(`/api/v1/guest/${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
}

function formatInstant(iso: string, timeZone: string | undefined): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  };
  const date = new Date(iso);
  const inProperty = new Intl.DateTimeFormat(lang, {
    ...options,
    timeZone,
    timeZoneName: "short",
  }).format(date);
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timeZone || device === timeZone) return inProperty;
  const local = new Intl.DateTimeFormat(lang, { ...options, timeZoneName: "short" }).format(date);
  return `${inProperty} (${text("stay.deviceTime", { time: local })})`;
}

function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(lang, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

// Copy buttons -------------------------------------------------------------------------------------

function wireCopy(button: HTMLButtonElement): void {
  if (!navigator.clipboard) return;
  button.hidden = false;
  button.addEventListener("click", () => {
    void navigator.clipboard.writeText(button.dataset.copy ?? "").then(() => {
      button.textContent = text("copy.copied") || button.textContent;
      setTimeout(() => (button.textContent = text("copy.copy") || button.textContent), 2000);
    });
  });
}

// Locked fields ------------------------------------------------------------------------------------

const fields = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(".locked[data-field-id]"));

function setStatus(field: HTMLElement, message: string): void {
  const status = field.querySelector<HTMLElement>(".locked-status");
  if (status) status.textContent = message;
}

function clearValue(field: HTMLElement): void {
  field.querySelector(".locked-reveal")?.remove();
}

function showButton(field: HTMLElement): void {
  if (field.querySelector(".locked-show")) return;
  const button = el("button", "button-primary locked-show", text("locked.show"));
  button.type = "button";
  button.addEventListener("click", () => void reveal(field, button));
  field.querySelector(".locked-status")?.after(button);
}

function applyState(): void {
  for (const field of fields()) {
    field.dataset.state = session?.state ?? "public";
    field.querySelector(".locked-show")?.remove();
    clearValue(field);
    if (!navigator.onLine || root.dataset.offlineAt) {
      setStatus(field, text("locked.offline"));
      continue;
    }
    switch (session?.state) {
      case "before":
        setStatus(
          field,
          text("locked.before", { date: formatInstant(session.opensAt ?? "", session.timeZone) }),
        );
        break;
      case "inside":
        setStatus(field, "");
        showButton(field);
        break;
      case "ended":
        setStatus(field, text("locked.ended"));
        break;
      default:
        setStatus(field, text("locked.public"));
    }
  }
}

function stayCard(): void {
  const card = document.getElementById("stay-card");
  if (!card) return;
  const stay = session?.stay;
  if (!stay || (session?.state !== "before" && session?.state !== "inside")) {
    card.hidden = true;
    return;
  }
  const checkIn = `${formatDay(stay.checkInDate)}${stay.checkInTime ? `, ${stay.checkInTime}` : ""}`;
  const checkout = `${formatDay(stay.checkoutDate)}${stay.checkoutTime ? `, ${stay.checkoutTime}` : ""}`;
  card.replaceChildren(
    el("h2", "card-title", text("stay.title")),
    el("p", "", text("stay.dates", { checkIn, checkout })),
  );
  card.hidden = false;
}

async function reveal(field: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = text("locked.showing");
  try {
    const response = await api("reveals", { publicId, fieldId: field.dataset.fieldId });
    if (response.ok) {
      const { value } = (await response.json()) as { value: string };
      button.remove();
      const box = el("span", "locked-reveal");
      const shown = el("span", "locked-value", value);
      shown.setAttribute(
        "aria-label",
        text("locked.spelled", { characters: value.split("").join(" ") }),
      );
      const copy = el("button", "copy", text("copy.copy"));
      copy.type = "button";
      copy.dataset.copy = value;
      box.append(shown, copy, el("span", "locked-note", text("locked.viewed")));
      field.querySelector(".locked-status")?.after(box);
      wireCopy(copy);
      return;
    }
    const problem = (await response.json().catch(() => ({}))) as { code?: string };
    if (problem.code === "verification_required") {
      openVerify(field);
    } else if (problem.code === "not_in_window" || problem.code === "no_session") {
      await loadSession();
      return;
    } else {
      setStatus(field, text("locked.error"));
    }
  } catch {
    setStatus(field, navigator.onLine ? text("locked.error") : text("locked.offline"));
  }
  button.disabled = false;
  button.textContent = label;
}

// Confirmation code (G-04) ---------------------------------------------------------------------------

function openVerify(field: HTMLElement): void {
  document.getElementById("verify")?.remove();
  const sheet = el("div", "sheet");
  sheet.id = "verify";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "verify-title");
  const form = el("form", "sheet-body");
  const title = el("h2", "card-title", text("verify.title"));
  title.id = "verify-title";
  const input = el("input", "input");
  input.id = "verify-code";
  input.name = "code";
  input.autocomplete = "one-time-code";
  input.autocapitalize = "characters";
  input.maxLength = 12;
  input.required = true;
  const labelEl = el("label", "label", text("verify.label"));
  labelEl.htmlFor = input.id;
  const message = el("p", "error");
  message.setAttribute("role", "alert");
  const submit = el("button", "button-primary", text("verify.submit"));
  submit.type = "submit";
  const cancel = el("button", "button-secondary", text("verify.cancel"));
  cancel.type = "button";
  cancel.addEventListener("click", () => sheet.remove());
  form.append(
    title,
    el("p", "", text("verify.body")),
    labelEl,
    input,
    message,
    submit,
    cancel,
    el("p", "muted", text("locked.fallback")),
  );
  sheet.append(form);
  document.body.append(sheet);
  input.focus();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      submit.disabled = true;
      const response = await api("verify", { publicId, code: input.value }).catch(() => null);
      submit.disabled = false;
      if (response?.status === 204) {
        sheet.remove();
        const button = field.querySelector<HTMLButtonElement>(".locked-show");
        if (button) void reveal(field, button);
        return;
      }
      const problem = response
        ? ((await response.json().catch(() => ({}))) as {
            code?: string;
            attemptsLeft?: number;
            retryAfterSeconds?: number;
          })
        : {};
      if (problem.code === "verification_locked") {
        const minutes = Math.ceil((problem.retryAfterSeconds ?? 900) / 60);
        message.textContent = text("verify.locked", { minutes });
        submit.disabled = true;
      } else if (problem.code === "invalid_code") {
        message.textContent = text("verify.wrong", { count: problem.attemptsLeft ?? 0 });
      } else {
        message.textContent = text("locked.error");
      }
    })();
  });
}

// Session, notices, opens ----------------------------------------------------------------------------

async function loadSession(): Promise<void> {
  if (!publicId) return;
  try {
    const response = await api(`session?publicId=${publicId}`);
    session = response.ok ? ((await response.json()) as Session) : null;
  } catch {
    session = null;
  }
  applyState();
  stayCard();
}

function countOpen(): void {
  if (!publicId) return;
  const key = `guidesk_open:${publicId}`;
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
  } catch {
    return;
  }
  const kind = session && session.state !== "public" ? "stay" : "property";
  void api("opens", { publicId, kind }).catch(() => undefined);
}

function showNotice(): void {
  const box = document.getElementById("notice");
  let notice: string | null;
  try {
    notice = sessionStorage.getItem("guidesk_notice");
    sessionStorage.removeItem("guidesk_notice");
  } catch {
    return;
  }
  if (!box || !notice) return;
  box.textContent = text(notice === "device_limit" ? "notice.deviceLimit" : "notice.ended");
  box.hidden = false;
}

function offlineBanner(): void {
  const at = root.dataset.offlineAt;
  const box = document.getElementById("offline-banner");
  if (!at || !box) return;
  const time = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(
    new Date(at),
  );
  box.textContent = text("offline.banner", { time });
  box.hidden = false;
}

// Stay link exchange (research R5) -------------------------------------------------------------------

async function exchange(container: HTMLElement): Promise<void> {
  const token = location.pathname.split("/")[2] ?? "";
  try {
    const response = await api("stay-sessions", { token });
    if (response.ok) {
      const result = (await response.json()) as { guideUrl: string; notice: string | null };
      if (result.notice) sessionStorage.setItem("guidesk_notice", result.notice);
      location.replace(result.guideUrl);
      return;
    }
    if (response.status === 404) {
      location.replace("/g/unavailable");
      return;
    }
  } catch {
    // Network failure: offer a retry below.
  }
  const retry = el("button", "button-primary", text("exchange.retry"));
  retry.type = "button";
  retry.addEventListener("click", () => location.reload());
  container.append(el("p", "lead", text("exchange.failed")), retry);
}

// Start -----------------------------------------------------------------------------------------------

function start(): void {
  const exchanging = document.getElementById("exchange");
  if (exchanging) {
    void exchange(exchanging);
    return;
  }
  document.querySelectorAll<HTMLButtonElement>("button.copy[data-copy]").forEach(wireCopy);
  document.querySelectorAll<HTMLAnchorElement>("a[data-switch-locale]").forEach((link) => {
    link.addEventListener("click", () => {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `guidesk_lang=${link.dataset.switchLocale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    });
  });
  showNotice();
  offlineBanner();
  void loadSession().then(countOpen);
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > HIDE_AFTER_MS) applyState();
  });
  window.addEventListener("online", () => void loadSession());
  window.addEventListener("offline", applyState);
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
}

start();
