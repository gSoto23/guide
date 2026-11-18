"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { ApiError } from "./api";
import type { StepUpMethod } from "./step-up";

/** Loaded only when the API asks for a recent sign-in, so pages don't carry it up front. */
const StepUpDialog = dynamic(
  () => import("@/components/step-up-dialog").then((module) => module.StepUpDialog),
  { ssr: false },
);

/**
 * Runs an API action; if the API asks for re-authentication (FR-011), shows the step-up dialog
 * and retries once it succeeds. Resolves to undefined when the user cancels.
 */
export function useStepUp(): {
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<{
    methods: StepUpMethod[];
    done: () => void;
    cancel: () => void;
  } | null>(null);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof ApiError) || error.problem.code !== "step_up_required") throw error;
      const methods = (error.problem.methods ?? ["email_otp"]) as StepUpMethod[];
      return new Promise<T | undefined>((resolve, reject) => {
        setPending({
          methods,
          done: () => {
            setPending(null);
            action().then(resolve, reject);
          },
          cancel: () => {
            setPending(null);
            resolve(undefined);
          },
        });
      });
    }
  }

  const dialog = pending ? (
    <StepUpDialog methods={pending.methods} onDone={pending.done} onCancel={pending.cancel} />
  ) : null;
  return { run, dialog };
}

/** The translated message for an API error code, or a generic one. */
export function errorKey(error: unknown, known: readonly string[]): string {
  const code = error instanceof ApiError ? error.problem.code : "internal_error";
  return known.includes(code) ? code : "internal_error";
}
