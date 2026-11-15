import type { EmailLocale } from "../locale.js";
import { formatDate, renderNotice, type Rendered } from "../notice.js";

export type MemberRole = "owner" | "admin" | "agent";

const roles: Record<EmailLocale, Record<MemberRole, string>> = {
  es: { owner: "dueño", admin: "administrador", agent: "agente" },
  en: { owner: "owner", admin: "admin", agent: "agent" },
};

/** `team.member_removed` (FR-025). */
export function renderMemberRemoved(locale: EmailLocale, workspaceName: string): Promise<Rendered> {
  return locale === "en"
    ? renderNotice(locale, {
        subject: `You no longer have access to ${workspaceName}`,
        heading: `Your access to ${workspaceName} ended`,
        paragraphs: [
          `An owner or admin removed you from ${workspaceName} on Guidesk. Your account and your other workspaces are not affected.`,
        ],
      })
    : renderNotice(locale, {
        subject: `Ya no tienes acceso a ${workspaceName}`,
        heading: `Terminó tu acceso a ${workspaceName}`,
        paragraphs: [
          `Un dueño o administrador te quitó de ${workspaceName} en Guidesk. Tu cuenta y tus otros workspaces no cambian.`,
        ],
      });
}

/** `team.role_changed`. */
export function renderRoleChanged(
  locale: EmailLocale,
  details: { workspaceName: string; from: MemberRole; to: MemberRole },
): Promise<Rendered> {
  const r = roles[locale];
  return locale === "en"
    ? renderNotice(locale, {
        subject: `Your role in ${details.workspaceName} changed`,
        heading: `You're now ${r[details.to]} in ${details.workspaceName}`,
        paragraphs: [`Your role changed from ${r[details.from]} to ${r[details.to]}.`],
      })
    : renderNotice(locale, {
        subject: `Cambió tu rol en ${details.workspaceName}`,
        heading: `Ahora eres ${r[details.to]} en ${details.workspaceName}`,
        paragraphs: [`Tu rol cambió de ${r[details.from]} a ${r[details.to]}.`],
      });
}

/** `team.ownership_transferred` (FR-026), to the previous and the new owner. */
export function renderOwnershipTransferred(
  locale: EmailLocale,
  details: { workspaceName: string; newOwnerName: string; recipientIsNewOwner: boolean },
): Promise<Rendered> {
  if (locale === "en") {
    return renderNotice(locale, {
      subject: `${details.workspaceName} has a new owner`,
      heading: details.recipientIsNewOwner
        ? `You're now the owner of ${details.workspaceName}`
        : `${details.newOwnerName} now owns ${details.workspaceName}`,
      paragraphs: [
        details.recipientIsNewOwner
          ? "You can now manage billing, transfer ownership, or delete the workspace."
          : "You stay in the workspace as an admin.",
      ],
      security: true,
    });
  }
  return renderNotice(locale, {
    subject: `${details.workspaceName} tiene un nuevo dueño`,
    heading: details.recipientIsNewOwner
      ? `Ahora eres dueño de ${details.workspaceName}`
      : `${details.newOwnerName} ahora es dueño de ${details.workspaceName}`,
    paragraphs: [
      details.recipientIsNewOwner
        ? "Ahora puedes gestionar el plan, transferir la propiedad o eliminar el workspace."
        : "Sigues en el workspace como administrador.",
    ],
    security: true,
  });
}

/** `workspace.deletion_scheduled` (FR-027), to every member. */
export function renderWorkspaceDeletionScheduled(
  locale: EmailLocale,
  details: { workspaceName: string; purgeAfter: Date },
): Promise<Rendered> {
  const when = formatDate(locale, details.purgeAfter);
  return locale === "en"
    ? renderNotice(locale, {
        subject: `${details.workspaceName} will be deleted`,
        heading: `${details.workspaceName} will be deleted on ${when}`,
        paragraphs: [
          "The owner deleted this workspace. Until that date, only the owner can restore it; after it, its data is permanently deleted.",
        ],
      })
    : renderNotice(locale, {
        subject: `${details.workspaceName} se eliminará`,
        heading: `${details.workspaceName} se eliminará el ${when}`,
        paragraphs: [
          "El dueño eliminó este workspace. Hasta esa fecha solo el dueño puede restaurarlo; después, sus datos se borran para siempre.",
        ],
      });
}

/** `workspace.restored`, to every member. */
export function renderWorkspaceRestored(
  locale: EmailLocale,
  workspaceName: string,
): Promise<Rendered> {
  return locale === "en"
    ? renderNotice(locale, {
        subject: `${workspaceName} is active again`,
        heading: `${workspaceName} was restored`,
        paragraphs: ["The owner restored the workspace. Everything is back as it was."],
      })
    : renderNotice(locale, {
        subject: `${workspaceName} está activo otra vez`,
        heading: `${workspaceName} fue restaurado`,
        paragraphs: ["El dueño restauró el workspace. Todo vuelve a estar como antes."],
      });
}
