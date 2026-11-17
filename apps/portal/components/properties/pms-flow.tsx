"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type {
  ImportRun,
  PmsListingList,
  PmsListingOption,
  PropertyLimits,
  StartOptions,
} from "@guidesk/contracts";
import { problemNumber, problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import { PmsConnect } from "./pms-connect";
import { PmsListingSelect } from "./pms-listing-select";

type Provider = StartOptions["pmsProviders"][number];

/**
 * "Import from your PMS" (US4, T098): connect with the host's own credential (after step-up),
 * choose the listings, and start the background import, which continues on the run's page. With
 * `connectionId`, it starts at the choice, for importing more from a saved connection (FR-033).
 */
export function PmsFlow({
  locale,
  connectionId,
  provider,
}: {
  locale: string;
  connectionId: string | null;
  provider: string | null;
}) {
  const t = useTranslations("properties");
  const pms = useTranslations("properties.pms");
  const errors = useTranslations("errors");
  const router = useRouter();
  const workspace = useWorkspace();
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [connection, setConnection] = useState<{ id: string; listings: PmsListingOption[] } | null>(
    null,
  );
  const [limits, setLimits] = useState<PropertyLimits | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!workspace?.canManage) return;
    const controller = new AbortController();
    const api = workspace.api;
    Promise.all([
      api.get<StartOptions>("/properties/start-options", controller.signal),
      api.get<PropertyLimits>("/properties/limits", controller.signal),
    ])
      .then(([options, usage]) => {
        setProviders(options.pmsProviders);
        setLimits(usage);
      })
      .catch(() => setProviders([]));
    if (connectionId) {
      api
        .get<PmsListingList>(
          `/pms-connections/${encodeURIComponent(connectionId)}/listings`,
          controller.signal,
        )
        .then((list) => setConnection({ id: connectionId, listings: list.items }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const code = problemOf(error)?.code;
          setMessage(
            code === "provider_unavailable" ? pms("unavailable") : errors("internal_error"),
          );
        });
    }
    return () => controller.abort();
  }, [workspace, connectionId, pms, errors]);

  if (!workspace) return <p className="muted">{t("loading")}</p>;
  if (!workspace.canManage) return <p className="muted">{t("start.notAllowed")}</p>;
  if (!providers || !limits) return <p className="muted">{t("loading")}</p>;

  async function start(externalIds: string[]) {
    if (!workspace || !connection) return;
    setStarting(true);
    setMessage(null);
    try {
      const run = await workspace.api.post<ImportRun>(
        `/pms-connections/${connection.id}/imports`,
        { externalIds },
        { idempotent: true },
      );
      router.push(`/${locale}/properties/imports/${run.id}`);
    } catch (error) {
      const problem = problemOf(error);
      setMessage(
        problem?.code === "plan_limit_reached"
          ? t("limits.reached", { limit: problemNumber(problem, "limit") ?? limits!.limit })
          : errors(problem?.code === "network" ? "network" : "internal_error"),
      );
      setStarting(false);
    }
  }

  return (
    <>
      <h1>{pms("title")}</h1>
      {message ? (
        <p className="alert alert-error" role="alert">
          {message}
        </p>
      ) : null}
      {connection ? (
        <PmsListingSelect
          listings={connection.listings}
          free={Math.max(0, limits.limit - limits.used)}
          limit={limits.limit}
          busy={starting}
          onImport={start}
        />
      ) : connectionId ? (
        message ? null : (
          <p className="muted" role="status">
            {pms("loadingListings")}
          </p>
        )
      ) : providers.length === 0 ? (
        <p className="muted">{pms("noProviders")}</p>
      ) : (
        <PmsConnect
          providers={providers}
          initialProvider={providers.includes(provider as Provider) ? (provider as Provider) : null}
          onConnected={(created) => setConnection({ id: created.id, listings: created.listings })}
        />
      )}
    </>
  );
}
