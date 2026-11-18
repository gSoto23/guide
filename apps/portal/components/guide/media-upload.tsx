"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import type { MediaUpload, MediaView } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

const POLL_MS = 2000;
/** The malware scan and processing can take a couple of minutes (research R9). */
const GIVE_UP_MS = 4 * 60 * 1000;

/**
 * Adds a photo or a short video (FR-009, research R9): images are re-encoded in the browser first
 * (which also drops their location data early), files go straight to the uploads bucket through a
 * presigned form, and the media is ready once the worker has checked and cleaned it.
 */
export function MediaUploadButton({
  propertyId,
  kind,
  label,
  onReady,
  disabled,
}: {
  propertyId: string;
  kind: "image" | "video";
  label: string;
  onReady: (media: MediaView) => Promise<void>;
  disabled?: boolean;
}) {
  const t = useTranslations("guide.media");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "processing">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !workspace) return;
    setMessage(null);
    let blob: Blob = file;
    let contentType = file.type;
    if (kind === "image") {
      const { normalizeImage } = await import("@/lib/image-normalize");
      const normalized = await normalizeImage(file);
      if (!normalized.ok) {
        setMessage(
          normalized.reason === "cannot_decode"
            ? t("heicUnsupported")
            : t("rejected", { reason: t("reasons.too_large") }),
        );
        return;
      }
      blob = normalized.blob;
      contentType = "image/jpeg";
    }
    setStatus("uploading");
    try {
      const created = await workspace.api.post<MediaUpload>(
        `/properties/${propertyId}/guide/media`,
        { kind, contentType, size: blob.size, fileName: file.name.slice(0, 200) || "file" },
        { idempotent: true },
      );
      const body = new FormData();
      for (const [name, value] of Object.entries(created.upload.fields)) body.append(name, value);
      body.append("file", blob, file.name || "file");
      const uploaded = await fetch(created.upload.url, { method: "POST", body });
      if (!uploaded.ok) throw new Error("upload failed");
      setStatus("processing");
      let media = await workspace.api.post<MediaView>(
        `/properties/${propertyId}/guide/media/${created.mediaId}/complete`,
      );
      const started = Date.now();
      while (media.status === "processing" && Date.now() - started < GIVE_UP_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        media = await workspace.api.get<MediaView>(
          `/properties/${propertyId}/guide/media/${created.mediaId}`,
        );
      }
      if (media.status !== "ready") {
        setMessage(t("rejected", { reason: t(`reasons.${media.rejectReason ?? "unreadable"}`) }));
        return;
      }
      await onReady(media);
    } catch (caught) {
      const code = problemOf(caught)?.code;
      setMessage(
        code === "storage_limit_reached" || code === "item_limit" || code === "network"
          ? errors(code)
          : errors("internal_error"),
      );
    } finally {
      setStatus("idle");
    }
  }

  return (
    <span className="file-buttons">
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        accept={kind === "image" ? "image/*" : "video/mp4,video/quicktime"}
        capture={kind === "image" ? "environment" : undefined}
        onChange={pick}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        className="button button-secondary"
        disabled={disabled || status !== "idle"}
        onClick={() => input.current?.click()}
      >
        {status === "uploading"
          ? t("uploading")
          : status === "processing"
            ? t("processing")
            : label}
      </button>
      {message && (
        <span className="field-error" role="alert">
          {message}
        </span>
      )}
    </span>
  );
}
