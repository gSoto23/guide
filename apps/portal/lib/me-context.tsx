"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { MeResponse } from "@guidesk/contracts";
import { ApiError, apiFetch } from "./api";

interface MeContextValue {
  me: MeResponse | null;
  /** Reloads /me, for example after switching or creating a workspace. */
  refresh: () => Promise<void>;
}

const MeContext = createContext<MeContextValue | null>(null);

/**
 * Loads /api/v1/me once for every signed-in screen and shares it, so the workspace switcher and
 * the page always agree on the current workspace (US4). Signed-out visitors go to sign-in.
 */
export function MeProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await apiFetch<MeResponse>("/api/v1/me"));
    } catch (error) {
      if (error instanceof ApiError && error.problem.status === 401) {
        router.replace(`/${locale}/sign-in`);
      }
    }
  }, [locale, router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <MeContext.Provider value={{ me, refresh }}>{children}</MeContext.Provider>;
}

export function useMeContext(): MeContextValue | null {
  return useContext(MeContext);
}
