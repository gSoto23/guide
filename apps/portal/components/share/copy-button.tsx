"use client";

import { useState } from "react";
import { check, copy, Icon } from "@guidesk/ui";

/** Copies text to the clipboard and confirms in place (feature 004 Share screen). */
export function CopyButton({
  text,
  label,
  copiedLabel,
  className = "button button-secondary",
}: {
  text: string;
  label: string;
  copiedLabel: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        });
      }}
    >
      <Icon data={copied ? check : copy} />
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}
