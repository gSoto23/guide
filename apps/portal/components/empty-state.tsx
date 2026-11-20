import type { ReactNode } from "react";
import { Illustration, type IllustrationData } from "@guidesk/ui";

/**
 * An illustrated empty state (feature 015 FR-019, design system "Empty state"): why the page is
 * empty and the one thing to do next. The illustration is decorative.
 */
export function EmptyState({
  illustration,
  title,
  body,
  action,
}: {
  illustration: IllustrationData;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Illustration data={illustration} width={200} />
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}
