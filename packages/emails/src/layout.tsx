import type { ReactNode } from "react";
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";
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
          backgroundColor: "#ffffff",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <Container style={{ maxWidth: "480px", padding: "24px 16px" }}>
          <Text style={{ fontSize: "18px", fontWeight: 700, color: "#111827" }}>Guidesk</Text>
          <Section>{children}</Section>
          {security ? (
            <>
              <Hr />
              <Text style={{ fontSize: "13px", color: "#4b5563" }}>{footer[locale]}</Text>
            </>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
