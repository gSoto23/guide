/**
 * The in-guide chat (feature 005 research R10, budget 30 KB gzip with its styles). Loaded by the
 * page script on the first tap of Ask. It reads its strings from the page's JSON data block, shows
 * every message as plain text, and polls for replies: every 1.5 seconds while one is pending,
 * every 5 seconds otherwise, only while the chat is open (research R2, FR-007).
 */
type Texts = Record<string, string>;

interface Section {
  id: string;
  title: string;
}

interface Message {
  seq: number;
  author: "guest" | "assistant" | "host";
  kind: "text" | "holding" | "emergency" | "pointer" | "greeting" | "pause";
  body: string;
  sections: Section[];
  authorName: string | null;
  emergency?: { number: string | null; text: string | null };
}

interface Chat {
  intro: {
    propertyName: string;
    hostName: string | null;
    emergencyNumber: string | null;
    suggestions: string[];
  };
  conversation: { status: string; pending: boolean } | null;
  messages: Message[];
}

const MAX = 2000;
const FAST_MS = 1500;
const SLOW_MS = 5000;

const root = document.documentElement;
const publicId = root.dataset.publicId ?? "";
const lang = root.lang === "en" ? "en" : "es";
const block = document.getElementById("guest-texts");
const texts: Texts = block ? (JSON.parse(block.textContent ?? "{}") as Texts) : {};

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

function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// The panel --------------------------------------------------------------------------------------------

const dialog = el("dialog", "chat");
dialog.setAttribute("aria-labelledby", "chat-title");
const head = el("div", "chat-head");
const title = el("h2", "chat-title");
title.id = "chat-title";
const close = el("button", "chat-close", "×");
close.type = "button";
close.setAttribute("aria-label", text("chat.close"));
head.append(title, close);

const body = el("div", "chat-body");
const intro = el("section", "chat-intro");
intro.hidden = true;
const log = el("div", "chat-log");
log.setAttribute("role", "list");
const typing = el("p", "chat-typing", text("chat.typing"));
typing.hidden = true;
// Complete replies are announced once (FR-005); the guest's own messages are not.
const live = el("p", "visually-hidden");
live.setAttribute("aria-live", "polite");
body.append(intro, log, typing, live);

const form = el("form", "chat-form");
const label = el("label", "visually-hidden", text("chat.label"));
label.htmlFor = "chat-input";
const input = el("textarea", "chat-input");
input.id = "chat-input";
input.rows = 2;
input.maxLength = MAX;
input.placeholder = text("chat.placeholder");
input.setAttribute("aria-describedby", "chat-counter");
const row = el("div", "chat-row");
const counter = el("span", "chat-counter");
counter.id = "chat-counter";
const send = el("button", "button-primary chat-send", text("chat.send"));
send.type = "submit";
row.append(counter, send);
const status = el("p", "chat-status");
status.setAttribute("role", "alert");
status.hidden = true;
form.append(label, input, row, status);
dialog.append(head, body, form);
document.body.append(dialog);

let lastSeq = 0;
let loaded = false;
let pending = false;
let sending = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let clientId = uuid();
let sentText = "";

function showStatus(message: string | null): void {
  status.textContent = message ?? "";
  status.hidden = !message;
}

function updateCounter(): void {
  counter.textContent = text("chat.counter", { count: [...input.value].length });
}

function who(message: Message): string {
  if (message.author === "guest") return text("chat.you");
  if (message.author === "host" && message.authorName) {
    return text("chat.host", { name: message.authorName });
  }
  return text("chat.assistant");
}

function render(message: Message): HTMLElement {
  const item = el("div", `chat-msg chat-msg-${message.author}`);
  item.setAttribute("role", "listitem");
  item.dataset.seq = String(message.seq);
  item.append(el("p", "chat-who", who(message)));
  if (message.kind === "emergency") {
    const card = el("div", "chat-emergency");
    card.append(el("p", "chat-emergency-title", text("chat.emergencyTitle")));
    card.append(el("p", "chat-text", message.body));
    const number = message.emergency?.number;
    if (number) {
      const call = el("a", "button-danger", text("chat.call", { number }));
      call.href = `tel:${number.replace(/[^\d+]/g, "")}`;
      card.append(call);
    }
    if (message.emergency?.text) card.append(el("p", "chat-text", message.emergency.text));
    item.append(card);
  } else {
    item.append(el("p", "chat-text", message.body));
  }
  if (message.sections.length > 0) {
    const source = el("p", "chat-source", `${text("chat.source")} `);
    message.sections.forEach((section, index) => {
      if (index > 0) source.append(", ");
      const link = el("a", undefined, section.title);
      link.href = `/g/${publicId}/${lang}/${section.id}`;
      source.append(link);
    });
    item.append(source);
  }
  return item;
}

function add(messages: Message[], announce: boolean): void {
  for (const message of messages) {
    if (message.seq <= lastSeq) continue;
    lastSeq = message.seq;
    log.append(render(message));
    if (announce && message.author !== "guest") {
      live.textContent = `${who(message)}: ${message.body}`;
    }
  }
  body.scrollTop = body.scrollHeight;
}

function setPending(value: boolean): void {
  pending = value;
  typing.hidden = !value;
}

function introOf(chat: Chat): void {
  const { propertyName, hostName, emergencyNumber, suggestions } = chat.intro;
  title.textContent = text("chat.title", { property: propertyName });
  intro.replaceChildren(
    el(
      "p",
      undefined,
      hostName
        ? text("chat.intro", { property: propertyName, host: hostName })
        : text("chat.introNoHost", { property: propertyName }),
    ),
  );
  intro.hidden = false;
  if (emergencyNumber) {
    const line = el("p", "chat-intro-emergency");
    const call = el("a", undefined, text("chat.introEmergency", { number: emergencyNumber }));
    call.href = `tel:${emergencyNumber.replace(/[^\d+]/g, "")}`;
    line.append(call);
    intro.append(line);
  }
  intro.append(el("p", "chat-muted", text("chat.introPlatform")));
  const asks = suggestions.map((key) => text(`chat.suggestions.${key}`)).filter(Boolean);
  if (asks.length > 0) {
    intro.append(el("p", "chat-muted", text("chat.suggestionsTitle")));
    const list = el("div", "chat-suggestions");
    for (const ask of asks) {
      const button = el("button", "button-secondary", ask);
      button.type = "button";
      button.addEventListener("click", () => void submit(ask));
      list.append(button);
    }
    intro.append(list);
  }
}

function schedule(): void {
  clearTimeout(timer);
  if (!dialog.open) return;
  timer = setTimeout(() => void poll(), pending ? FAST_MS : SLOW_MS);
}

async function poll(): Promise<void> {
  if (!navigator.onLine) {
    showStatus(text("chat.offline"));
    schedule();
    return;
  }
  try {
    const after = loaded ? `&after=${lastSeq}` : "";
    const response = await fetch(`/api/v1/guest/chat?publicId=${publicId}${after}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status === 404) {
      showStatus(text("chat.unavailable"));
      form.hidden = true;
      return;
    }
    if (response.ok) {
      const chat = (await response.json()) as Chat;
      if (!loaded) introOf(chat);
      add(chat.messages, loaded);
      loaded = true;
      setPending(chat.conversation?.pending ?? false);
      if (status.textContent === text("chat.offline")) showStatus(null);
    }
  } catch {
    // Network hiccup: try again on the next tick.
  }
  schedule();
}

async function submit(value: string): Promise<void> {
  const message = value.trim();
  if (!message || sending) return;
  if ([...message].length > MAX) {
    showStatus(text("chat.tooLong"));
    return;
  }
  // A retry of the same text keeps its ID, so the server stores it once.
  if (message !== sentText) {
    clientId = uuid();
    sentText = message;
  }
  sending = true;
  send.disabled = true;
  showStatus(null);
  try {
    const response = await fetch("/api/v1/guest/chat/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicId, text: message, language: lang, clientId }),
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status === 202) {
      const result = (await response.json()) as { message: Message; pending: boolean };
      add([result.message], false);
      setPending(result.pending);
      if (input.value.trim() === message) input.value = "";
      sentText = "";
      updateCounter();
    } else if (response.status === 429) {
      const problem = (await response.json().catch(() => ({}))) as { retryAfterSeconds?: number };
      const minutes = Math.max(1, Math.ceil((problem.retryAfterSeconds ?? 600) / 60));
      showStatus(text("chat.paused", { minutes }));
    } else if (response.status === 422) {
      showStatus(text("chat.tooLong"));
    } else if (response.status === 404) {
      showStatus(text("chat.unavailable"));
    } else {
      showStatus(text("chat.error"));
    }
  } catch {
    showStatus(text("chat.error"));
  } finally {
    sending = false;
    send.disabled = false;
  }
  schedule();
}

function open(): void {
  if (!dialog.open) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }
  input.focus();
  if (!loaded) title.textContent = text("chat.loading");
  void poll();
}

function shut(): void {
  clearTimeout(timer);
  if (dialog.open) dialog.close();
  document.getElementById("ask")?.focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit(input.value);
});
input.addEventListener("input", updateCounter);
input.addEventListener("keydown", (event) => {
  // Enter sends; Shift+Enter makes a new line.
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void submit(input.value);
  }
});
close.addEventListener("click", shut);
dialog.addEventListener("close", () => clearTimeout(timer));
document.addEventListener("guidesk:ask", open);
window.addEventListener("online", () => dialog.open && void poll());
updateCounter();
open();
