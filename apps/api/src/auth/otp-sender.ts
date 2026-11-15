import { eq } from "drizzle-orm";
import { localeFromAcceptLanguage, renderSignInCode, toEmailLocale } from "@guidesk/emails";
import { user, type Database } from "@guidesk/db";
import type { EmailAdapter } from "@guidesk/integrations";
import type { OtpEmail } from "./options.js";

/**
 * Sends `auth.signin_code` (T040) in the user's language: their saved preference, or the
 * request's Accept-Language for new users, or Spanish.
 */
export function createOtpSender(email: EmailAdapter, db: Database) {
  return async ({ email: to, otp, acceptLanguage }: OtpEmail): Promise<void> => {
    const [existing] = await db
      .select({ preferredLanguage: user.preferredLanguage })
      .from(user)
      .where(eq(user.email, to.toLowerCase()))
      .limit(1);
    const locale = existing?.preferredLanguage
      ? toEmailLocale(existing.preferredLanguage)
      : (localeFromAcceptLanguage(acceptLanguage) ?? "es");
    const rendered = await renderSignInCode(locale, otp);
    await email.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      template: "auth.signin_code",
    });
  };
}
