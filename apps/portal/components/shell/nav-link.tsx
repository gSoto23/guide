"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { currentDestination, MORE_DESTINATIONS, type DestinationId } from "./destinations";

/** Closes the More list after a choice, since client navigation keeps the popover open. */
function closePopover(event: MouseEvent<HTMLAnchorElement>) {
  const popover = event.currentTarget.closest<HTMLElement>("[popover]");
  if (popover && typeof popover.hidePopover === "function" && popover.matches(":popover-open")) {
    popover.hidePopover();
  }
}

/** A navigation entry that marks itself as the current page (spec FR-005, research R4). */
export function NavLink({
  id,
  href,
  className,
  children,
}: {
  id: DestinationId;
  href: string;
  className: string;
  children: ReactNode;
}) {
  const current = currentDestination(usePathname()) === id;
  return (
    <Link
      href={href}
      className={current ? `${className} is-current` : className}
      aria-current={current ? "page" : undefined}
      onClick={closePopover}
    >
      {children}
    </Link>
  );
}

/** The More button of the bottom bar; marked when the current page lives under it. */
export function MoreButton({ children }: { children: ReactNode }) {
  const destination = currentDestination(usePathname());
  const current = destination !== null && MORE_DESTINATIONS.includes(destination);
  return (
    <button
      type="button"
      className={current ? "bottom-item is-current" : "bottom-item"}
      popoverTarget="more-menu"
    >
      {children}
    </button>
  );
}
