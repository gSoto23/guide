"use client";

import { useMemo } from "react";
import { useMeContext } from "./me-context";
import { workspaceApi, type WorkspaceApi } from "./properties-api";

export interface CurrentWorkspace {
  workspaceId: string;
  role: "owner" | "admin" | "agent";
  /** Owners and admins manage properties (FR-046). */
  canManage: boolean;
  api: WorkspaceApi;
}

/** The current workspace, the caller's role there, and a client for its routes. */
export function useWorkspace(): CurrentWorkspace | null {
  const context = useMeContext();
  const me = context?.me ?? null;
  const workspaceId = me?.lastWorkspaceId ?? null;
  const role = me?.memberships.find((m) => m.workspaceId === workspaceId)?.role ?? null;
  return useMemo(
    () =>
      workspaceId && role
        ? { workspaceId, role, canManage: role !== "agent", api: workspaceApi(workspaceId) }
        : null,
    [workspaceId, role],
  );
}
