"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { MeResponse } from "@guidesk/contracts";
import { ApiError, apiFetch } from "./api";
import { useMeContext } from "./me-context";

/**
 * The signed-in user. Inside the app layout it reads the shared MeProvider; elsewhere it loads
 * /api/v1/me itself and sends signed-out visitors to the sign-in page.
 */
export function useMe(locale: string) {
  const shared = useMeContext();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    if (shared) return;
    let cancelled = false;
    apiFetch<MeResponse>("/api/v1/me")
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.problem.status === 401) {
          router.replace(`/${locale}/sign-in`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [locale, router, shared]);

  return shared ? shared.me : me;
}
