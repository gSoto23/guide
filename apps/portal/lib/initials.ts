/**
 * Initials for avatars (feature 016 US4, research R6): up to two letters from the name, else the
 * first letter of the email. Letters are found by case mapping instead of Unicode property
 * regexes, which compile to large tables for older browsers and cost bundle size.
 */
function isLetterOrDigit(char: string): boolean {
  return char.toLowerCase() !== char.toUpperCase() || (char >= "0" && char <= "9");
}

function firstLetter(word: string): string {
  return Array.from(word).find(isLetterOrDigit) ?? "";
}

export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const words = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((word) => firstLetter(word) !== "");
  const fromName =
    words.length > 1
      ? firstLetter(words[0]!) + firstLetter(words.at(-1)!)
      : firstLetter(words[0] ?? "");
  const initials = fromName || firstLetter(email ?? "");
  return initials.toLocaleUpperCase() || "?";
}
