import type { LegalSection } from "@/lib/public/catalog";
import { legalDate } from "@/lib/public/legal";
import { fill, usableLines, type Values } from "@/lib/public/text";

/**
 * A legal page (feature 014 FR-006 to FR-008): title, last-updated date, contents, and sections.
 * Lines that need the contact address drop out when it is not configured, and a section with
 * nothing left is skipped.
 */
export function LegalDocument({
  locale,
  title,
  intro,
  sections,
  updatedLabel,
  tocLabel,
  values,
}: {
  locale: string;
  title: string;
  intro: readonly string[];
  sections: readonly LegalSection[];
  updatedLabel: string;
  tocLabel: string;
  values: Values;
}) {
  const shown = sections
    .map((section) => ({
      ...section,
      paragraphs: usableLines(section.paragraphs, values),
      items: usableLines(section.items, values),
      footer: usableLines(section.footer, values),
    }))
    .filter(
      (section) => section.paragraphs.length + section.items.length + section.footer.length > 0,
    );

  return (
    <article className="public-container legal">
      <h1>{title}</h1>
      <p className="legal-updated">{fill(updatedLabel, { date: legalDate(locale) })}</p>
      {usableLines(intro, values).map((line) => (
        <p key={line}>{line}</p>
      ))}
      <nav className="legal-toc" aria-labelledby="legal-toc-title">
        <h2 id="legal-toc-title">{tocLabel}</h2>
        <ol>
          {shown.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ol>
      </nav>
      {shown.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
          <h2 id={`${section.id}-title`}>{section.title}</h2>
          {section.paragraphs.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {section.items.length > 0 ? (
            <ul>
              {section.items.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {section.footer.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
