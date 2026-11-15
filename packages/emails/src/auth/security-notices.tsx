import { Heading, Text } from "@react-email/components";
import { EmailLayout } from "../layout.js";
import type { EmailLocale } from "../locale.js";
import { renderEmail, type RenderedEmail } from "../render.js";

type Rendered = RenderedEmail & { subject: string };

const newDeviceCopy = {
  es: {
    subject: "Nuevo inicio de sesión en Guidesk",
    heading: "Detectamos un inicio de sesión nuevo",
    body: (device: string, place: string, when: string) =>
      `Dispositivo: ${device}. Lugar aproximado: ${place}. Fecha: ${when}.`,
    unknown: "desconocido",
  },
  en: {
    subject: "New sign-in to Guidesk",
    heading: "We noticed a new sign-in",
    body: (device: string, place: string, when: string) =>
      `Device: ${device}. Approximate location: ${place}. Time: ${when}.`,
    unknown: "unknown",
  },
} as const;

/** `auth.new_device` (FR-012, contracts/emails.md). */
export async function renderNewDevice(
  locale: EmailLocale,
  details: { device: string; location: string | null; at: Date },
): Promise<Rendered> {
  const t = newDeviceCopy[locale];
  const when = details.at.toLocaleString(locale === "en" ? "en-US" : "es-CR", {
    timeZone: "UTC",
    timeZoneName: "short",
  });
  const element = (
    <EmailLayout locale={locale} preview={t.heading} security>
      <Heading as="h1" style={{ fontSize: "20px" }}>
        {t.heading}
      </Heading>
      <Text>{t.body(details.device, details.location ?? t.unknown, when)}</Text>
    </EmailLayout>
  );
  return { ...(await renderEmail(element)), subject: t.subject };
}

const lockoutCopy = {
  es: {
    subject: "Pausamos el inicio de sesión en tu cuenta de Guidesk",
    heading: "Pausamos el inicio de sesión",
    body: (minutes: number) =>
      `Hubo demasiados códigos incorrectos. Por seguridad, el inicio de sesión queda pausado ${minutes} minutos. Después puedes pedir un código nuevo.`,
  },
  en: {
    subject: "We paused sign-in to your Guidesk account",
    heading: "Sign-in is paused",
    body: (minutes: number) =>
      `There were too many wrong codes. For your security, sign-in is paused for ${minutes} minutes. After that you can ask for a new code.`,
  },
} as const;

/** `auth.lockout` (AC-SEC-001). */
export async function renderLockout(locale: EmailLocale, minutes: number): Promise<Rendered> {
  const t = lockoutCopy[locale];
  const element = (
    <EmailLayout locale={locale} preview={t.heading} security>
      <Heading as="h1" style={{ fontSize: "20px" }}>
        {t.heading}
      </Heading>
      <Text>{t.body(minutes)}</Text>
    </EmailLayout>
  );
  return { ...(await renderEmail(element)), subject: t.subject };
}

export type FactorChange = "passkey_added" | "passkey_removed" | "totp_enabled" | "totp_disabled";

const factorCopy = {
  es: {
    subject: "Cambió la seguridad de tu cuenta de Guidesk",
    heading: "Cambió la seguridad de tu cuenta",
    changes: {
      passkey_added: "Se agregó una passkey.",
      passkey_removed: "Se eliminó una passkey.",
      totp_enabled: "Se activó la app de autenticación.",
      totp_disabled: "Se desactivó la app de autenticación.",
    },
    device: (device: string) => `Desde: ${device}.`,
  },
  en: {
    subject: "Your Guidesk account security changed",
    heading: "Your account security changed",
    changes: {
      passkey_added: "A passkey was added.",
      passkey_removed: "A passkey was removed.",
      totp_enabled: "An authenticator app was turned on.",
      totp_disabled: "An authenticator app was turned off.",
    },
    device: (device: string) => `From: ${device}.`,
  },
} as const;

/** `auth.mfa_changed` (T064). */
export async function renderFactorChanged(
  locale: EmailLocale,
  change: FactorChange,
  device: string,
): Promise<Rendered> {
  const t = factorCopy[locale];
  const element = (
    <EmailLayout locale={locale} preview={t.heading} security>
      <Heading as="h1" style={{ fontSize: "20px" }}>
        {t.heading}
      </Heading>
      <Text>{t.changes[change]}</Text>
      <Text>{t.device(device)}</Text>
    </EmailLayout>
  );
  return { ...(await renderEmail(element)), subject: t.subject };
}
