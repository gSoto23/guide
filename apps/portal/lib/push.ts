"use client";

/**
 * Web push on this device (feature 006 research R7): support checks, the service worker, and the
 * browser subscription. The server stores the subscription for the signed-in member.
 */
export type PushSupport = "supported" | "unsupported" | "ios-home-screen";

const SUBSCRIPTION_ID_KEY = "guidesk-push-subscription";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return "ios-home-screen";
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  return "supported";
}

/** A short device label such as `chrome-android`, never the full user agent. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "edge"
    : /Firefox\//.test(ua)
      ? "firefox"
      : /Chrome\//.test(ua)
        ? "chrome"
        : /Safari\//.test(ua)
          ? "safari"
          : "browser";
  const os = /Android/.test(ua)
    ? "android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "ios"
      : /Mac OS X/.test(ua)
        ? "macos"
        : /Windows/.test(ua)
          ? "windows"
          : /Linux/.test(ua)
            ? "linux"
            : "other";
  return `${browser}-${os}`;
}

function keyBytes(base64url: string): Uint8Array {
  const padded = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Asks permission, registers the service worker, and subscribes; returns the browser subscription. */
export async function subscribe(publicKey: string): Promise<PushSubscription | "blocked"> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "blocked";
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey) as BufferSource,
  });
}

export function rememberSubscriptionId(id: string | null): void {
  try {
    if (id) localStorage.setItem(SUBSCRIPTION_ID_KEY, id);
    else localStorage.removeItem(SUBSCRIPTION_ID_KEY);
  } catch {
    // Private mode: the server still knows the device; turning it off asks again next time.
  }
}

export function rememberedSubscriptionId(): string | null {
  try {
    return localStorage.getItem(SUBSCRIPTION_ID_KEY);
  } catch {
    return null;
  }
}
