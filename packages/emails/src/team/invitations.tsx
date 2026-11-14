import { Button, Heading, Text } from "@react-email/components";
import { EmailLayout } from "../layout.js";
import type { EmailLocale } from "../locale.js";
import { renderEmail, type RenderedEmail } from "../render.js";

type Rendered = RenderedEmail & { subject: string };
export type InvitedRole = "admin" | "agent";

const roleNames: Record<EmailLocale, Record<InvitedRole, string>> = {
  es: { admin: "administrador", agent: "agente" },
  en: { admin: "admin", agent: "agent" },
};

const invitationCopy = {
  es: {
    subject: (workspace: string) => `Te invitaron a ${workspace} en Guidesk`,
    heading: (workspace: string) => `Únete a ${workspace}`,
    body: (inviter: string, workspace: string, role: string) =>
      `${inviter} te invitó a ${workspace} en Guidesk con el rol de ${role}.`,
    action: "Aceptar la invitación",
    expiry: (days: number) =>
      `El enlace vence en ${days} días y solo funciona con esta dirección de email.`,
    ignore: "Si no esperabas esta invitación, puedes ignorar este mensaje.",
    someone: "Alguien",
  },
  en: {
    subject: (workspace: string) => `You're invited to ${workspace} on Guidesk`,
    heading: (workspace: string) => `Join ${workspace}`,
    body: (inviter: string, workspace: string, role: string) =>
      `${inviter} invited you to ${workspace} on Guidesk as an ${role}.`,
    action: "Accept the invitation",
    expiry: (days: number) =>
      `The link expires in ${days} days and only works with this email address.`,
    ignore: "If you weren't expecting this invitation, you can ignore this email.",
    someone: "Someone",
  },
} as const;

/** `team.invitation` (FR-018, contracts/emails.md). Sent inline: the link holds a one-time token. */
export async function renderInvitation(
  locale: EmailLocale,
  details: {
    workspaceName: string;
    inviterName: string | null;
    role: InvitedRole;
    acceptUrl: string;
    expiresInDays: number;
  },
): Promise<Rendered> {
  const t = invitationCopy[locale];
  const role = roleNames[locale][details.role];
  const element = (
    <EmailLayout locale={locale} preview={t.heading(details.workspaceName)}>
      <Heading as="h1" style={{ fontSize: "20px" }}>
        {t.heading(details.workspaceName)}
      </Heading>
      <Text>{t.body(details.inviterName ?? t.someone, details.workspaceName, role)}</Text>
      <Button
        href={details.acceptUrl}
        style={{
          backgroundColor: "#0f766e",
          color: "#ffffff",
          padding: "12px 20px",
          borderRadius: "8px",
          fontWeight: 600,
        }}
      >
        {t.action}
      </Button>
      <Text style={{ fontSize: "13px", color: "#4b5563" }}>{t.expiry(details.expiresInDays)}</Text>
      <Text style={{ fontSize: "13px", color: "#4b5563" }}>{t.ignore}</Text>
    </EmailLayout>
  );
  return { ...(await renderEmail(element)), subject: t.subject(details.workspaceName) };
}

const acceptedCopy = {
  es: {
    subject: (name: string, workspace: string) => `${name} se unió a ${workspace}`,
    body: (name: string, workspace: string, role: string) =>
      `${name} aceptó tu invitación y ya forma parte de ${workspace} con el rol de ${role}.`,
  },
  en: {
    subject: (name: string, workspace: string) => `${name} joined ${workspace}`,
    body: (name: string, workspace: string, role: string) =>
      `${name} accepted your invitation and joined ${workspace} as ${role}.`,
  },
} as const;

/** `team.invitation_accepted` (contracts/emails.md): tells the inviter who joined. */
export async function renderInvitationAccepted(
  locale: EmailLocale,
  details: { memberName: string; workspaceName: string; role: InvitedRole },
): Promise<Rendered> {
  const t = acceptedCopy[locale];
  const role = roleNames[locale][details.role];
  const subject = t.subject(details.memberName, details.workspaceName);
  const element = (
    <EmailLayout locale={locale} preview={subject}>
      <Heading as="h1" style={{ fontSize: "20px" }}>
        {subject}
      </Heading>
      <Text>{t.body(details.memberName, details.workspaceName, role)}</Text>
    </EmailLayout>
  );
  return { ...(await renderEmail(element)), subject };
}
