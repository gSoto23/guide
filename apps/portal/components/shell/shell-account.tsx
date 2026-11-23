"use client";

import Link from "next/link";
import { useMeContext } from "@/lib/me-context";
import { Avatar } from "../avatar";
import { EmailText } from "../email-text";
import { WorkspaceSwitcher } from "../workspace-switcher";

/**
 * The workspace switcher in the shell, or a placeholder of the same size while the account loads
 * (feature 017 FR-020). Someone removed from their last workspace still sees the switcher, to
 * create one (spec 001 edge case).
 */
export function ShellSwitcher() {
  const context = useMeContext();
  if (!context?.me) return <div className="shell-placeholder" aria-hidden="true" />;
  return <WorkspaceSwitcher me={context.me} onChanged={context.refresh} />;
}

/** The account link at the bottom of the sidebar, once the account has loaded. */
export function ShellAccountLink({ href, hint }: { href: string; hint: string }) {
  const me = useMeContext()?.me;
  if (!me) return null;
  return (
    <Link href={href} className="side-account">
      <Avatar name={me.user.name} email={me.user.email} />
      <span>
        <span className="side-account-name">
          {me.user.name || <EmailText email={me.user.email} />}
        </span>
        <span className="side-account-hint">{hint}</span>
      </span>
    </Link>
  );
}
