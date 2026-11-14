import { Heading, Text } from "@react-email/components";
import { EmailLayout } from "../layout.js";
import type { EmailLocale } from "../locale.js";
import { renderEmail, type RenderedEmail } from "../render.js";

const copy: Record<
  EmailLocale,
  { subject: string; heading: string; body: string; expiry: string; ignore: string }
> = {
  es: {
    subject: "Tu código de Guidesk",
    heading: "Tu código para entrar",
    body: "Escribe este código en Guidesk para continuar:",
    expiry: "Vence en 10 minutos y solo funciona una vez.",
    ignore: "Si no pediste este código, ignora este correo. Nadie puede entrar sin él.",
  },
  en: {
    subject: "Your Guidesk code",
    heading: "Your sign-in code",
    body: "Enter this code in Guidesk to continue:",
    expiry: "It expires in 10 minutes and works only once.",
    ignore: "If you didn't request this code, ignore this email. Nobody can sign in without it.",
  },
};

export function SignInCodeEmail({ locale, code }: { locale: EmailLocale; code: string }) {
  const t = copy[locale];
  return (
    <EmailLayout locale={locale} preview={`${t.heading}: ${code}`}>
      <Heading as="h1" style={{ fontSize: "20px" }}>
        {t.heading}
      </Heading>
      <Text>{t.body}</Text>
      <Text style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "6px" }}>{code}</Text>
      <Text>{t.expiry}</Text>
      <Text style={{ fontSize: "13px", color: "#4b5563" }}>{t.ignore}</Text>
    </EmailLayout>
  );
}

/** Template `auth.signin_code` (contracts/emails.md, T040). No tracking pixels. */
export async function renderSignInCode(
  locale: EmailLocale,
  code: string,
): Promise<RenderedEmail & { subject: string }> {
  const rendered = await renderEmail(<SignInCodeEmail locale={locale} code={code} />);
  return { ...rendered, subject: copy[locale].subject };
}
