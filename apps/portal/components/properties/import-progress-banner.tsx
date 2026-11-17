"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ImportRun, ImportRunList } from "@guidesk/contracts";
import { useWorkspace } from "@/lib/use-workspace";

const POLL_MS = 5000;

/**
 * The portal's notice of a running import (FR-029, T099): "Importing 12 of 40", on every
 * signed-in page, for owners and admins. It disappears when the run finishes.
 */
export function ImportProgressBanner({ locale }: { locale: string }) {
  const t = useTranslations("properties.imports");
  const workspace = useWorkspace();
  const [run, setRun] = useState<ImportRun | null>(null);
  const api = workspace?.canManage ? workspace.api : null;
  // Checked again on each navigation, so a run started on another page shows up.
  const pathname = usePathname();

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const list = await api.get<ImportRunList>("/imports?status=running", controller.signal);
        setRun(list.items[0] ?? null);
        if (list.items.length > 0) timer = setTimeout(tick, POLL_MS);
      } catch {
        // The banner is a convenience; the run page shows the full state.
      }
    };
    void tick();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, pathname]);

  if (!run) return null;
  return (
    <p className="import-banner" role="status">
      <Link href={`/${locale}/properties/imports/${run.id}`}>
        {t("progress", { processed: run.processed, total: run.total })}
      </Link>
    </p>
  );
}
