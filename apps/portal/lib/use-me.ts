"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { MeResponse } from "@guidesk/contracts";
import { ApiError, apiFetch } from "./api";

/** Loads /api/v1/me and sends signed-out visitors to the sign-in page. */
export function useMe(locale: string) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
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
  }, [locale, router]);

  return me;
}
