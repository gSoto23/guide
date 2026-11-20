import { initialsOf } from "@/lib/initials";

/**
 * Initials avatars (feature 016 US4, research R6): up to two letters from the name, else the first
 * letter of the email, on a brand-tinted circle. No images, so nothing loads from a third party.
 * Decorative: the name is always written next to it.
 */
export function Avatar({
  name,
  email,
  size = 32,
}: {
  name: string | null | undefined;
  email?: string | null;
  size?: 24 | 32 | 40;
}) {
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initialsOf(name, email)}
    </span>
  );
}
