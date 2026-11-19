import type { ReactNode } from "react";
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";
import { BRAND } from "./brand.js";
import type { EmailLocale } from "./locale.js";

const footer: Record<EmailLocale, string> = {
  es: "Si no fuiste tú, revisa tus sesiones activas en Guidesk.",
  en: "If this wasn't you, review your active sessions in Guidesk.",
};

export interface EmailLayoutProps {
  locale: EmailLocale;
  preview: string;
  children: ReactNode;
  /** Security emails end with "If this wasn't you" guidance (contracts/emails.md). */
  security?: boolean;
}

/** Base layout for every transactional email (T023): readable on a phone, no tracking pixels. */
export function EmailLayout({ locale, preview, children, security = false }: EmailLayoutProps) {
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: BRAND.background,
          color: BRAND.text,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <Container style={{ maxWidth: "480px", padding: "24px 16px" }}>
          {/* The brand mark as a terracota bubble (no image, so nothing loads from outside). */}
          <Text style={{ fontSize: "18px", fontWeight: 700, color: BRAND.text }}>
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: "16px",
                height: "16px",
                marginRight: "8px",
                verticalAlign: "-2px",
                backgroundColor: BRAND.primary,
                borderRadius: "5px 5px 5px 0",
              }}
            />
            Guidesk
          </Text>
          <Section>{children}</Section>
          {security ? (
            <>
              <Hr style={{ borderColor: BRAND.line }} />
              <Text style={{ fontSize: "13px", color: BRAND.muted }}>{footer[locale]}</Text>
            </>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
