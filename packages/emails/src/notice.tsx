import { Heading, Text } from "@react-email/components";
import { EmailLayout } from "./layout.js";
import type { EmailLocale } from "./locale.js";
import { renderEmail, type RenderedEmail } from "./render.js";

export type Rendered = RenderedEmail & { subject: string };

/** A short notice: a heading and one or more paragraphs, all escaped by React. */
export async function renderNotice(
  locale: EmailLocale,
  content: { subject: string; heading: string; paragraphs: string[]; security?: boolean },
): Promise<Rendered> {
  const element = (
    <EmailLayout locale={locale} preview={content.heading} security={content.security ?? false}>
      <Heading as="h1" style={{ fontSize: "20px" }}>
        {content.heading}
      </Heading>
      {content.paragraphs.map((paragraph) => (
        <Text key={paragraph}>{paragraph}</Text>
      ))}
    </EmailLayout>
  );
  return { ...(await renderEmail(element)), subject: content.subject };
}

export function formatDate(locale: EmailLocale, date: Date): string {
  return date.toLocaleDateString(locale === "en" ? "en-US" : "es-CR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
