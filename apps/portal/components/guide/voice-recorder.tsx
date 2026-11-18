"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/** Voice notes stop at 2 minutes (research R8). */
export const MAX_RECORDING_SECONDS = 120;

/** The first container the browser records that the file processor accepts (R8). */
function recordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(
    (type) => MediaRecorder.isTypeSupported(type),
  );
}

/** The plain content type the API expects, from what the recorder reports. */
export function plainAudioType(type: string): "audio/webm" | "audio/mp4" | "audio/ogg" {
  if (type.startsWith("audio/mp4")) return "audio/mp4";
  if (type.startsWith("audio/ogg")) return "audio/ogg";
  return "audio/webm";
}

/**
 * Records one voice note with `MediaRecorder` (feature 003 US4, research R8): WebM with Opus on
 * Chrome and Firefox, MP4 on Safari, stopped at 2 minutes. The recording leaves the device only
 * when `onRecorded` uploads it.
 */
export function VoiceRecorder({
  disabled,
  onRecorded,
}: {
  disabled?: boolean;
  onRecorded: (blob: Blob) => void;
}) {
  const t = useTranslations("guide.interview");
  const [state, setState] = useState<"idle" | "recording" | "denied">("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(
    () => () => {
      clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const supported = typeof window !== "undefined" && recordingType() !== undefined;
  if (!supported) return null;

  function stop() {
    clearInterval(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  async function start() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("denied");
      return;
    }
    const type = recordingType();
    const media = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setState("idle");
      const blob = new Blob(chunks, { type: plainAudioType(media.mimeType || type || "") });
      if (blob.size > 0) onRecorded(blob);
    };
    recorder.current = media;
    media.start(1000);
    setSeconds(0);
    setState("recording");
    timer.current = setInterval(() => {
      setSeconds((current) => {
        if (current + 1 >= MAX_RECORDING_SECONDS) stop();
        return current + 1;
      });
    }, 1000);
  }

  return (
    <div className="voice-recorder">
      {state === "recording" ? (
        <>
          <span aria-live="polite">{t("recording", { seconds })}</span>{" "}
          <button type="button" className="button button-primary" onClick={stop}>
            {t("stop")}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled}
          onClick={() => void start()}
        >
          🎙 {t("record")}
        </button>
      )}
      {state === "denied" && <p className="field-error">{t("micDenied")}</p>}
    </div>
  );
}
