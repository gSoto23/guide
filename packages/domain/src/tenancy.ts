/** Workspace rules (spec 001 FR-004, data model §3). */
export const WORKSPACE_NAME_MAX = 80;

/** Default workspace name from the creator's name, trimmed to the allowed length (FR-004). */
export function defaultWorkspaceName(
  userName: string | null | undefined,
  locale: "es" | "en",
): string {
  const trimmed = (userName ?? "").trim();
  const fallback = locale === "en" ? "My workspace" : "Mi espacio de trabajo";
  if (!trimmed) {
    return fallback;
  }
  const name = locale === "en" ? `${trimmed}'s workspace` : `Espacio de ${trimmed}`;
  return name.length <= WORKSPACE_NAME_MAX ? name : name.slice(0, WORKSPACE_NAME_MAX).trimEnd();
}

const DEFAULT_NAME = /^(Mi espacio de trabajo|My workspace|Espacio de .+|.+'s workspace)$/;

/**
 * The host's name as guests see it (feature 005 FR-003): the workspace's name once the host has
 * chosen one, or null while it is still a default like "Espacio de Ana", which reads oddly to guests.
 */
export function hostDisplayName(workspaceName: string): string | null {
  const name = workspaceName.trim();
  return name && !DEFAULT_NAME.test(name) ? name : null;
}
