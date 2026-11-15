import { Global, Module } from "@nestjs/common";
import { SesEmailAdapter, SmtpEmailAdapter, type EmailAdapter } from "@guidesk/integrations";
import { API_CONFIG, type ApiConfig } from "../config/config.js";

export const EMAIL_ADAPTER = Symbol("EMAIL_ADAPTER");

/** NotificationPort wiring (T023): SMTP (Mailpit) locally, Amazon SES in AWS. */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL_ADAPTER,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): EmailAdapter =>
        config.EMAIL_TRANSPORT === "ses"
          ? new SesEmailAdapter({
              from: config.EMAIL_FROM,
              configurationSetName: config.SES_CONFIGURATION_SET,
            })
          : new SmtpEmailAdapter({
              host: config.SMTP_HOST,
              port: config.SMTP_PORT,
              from: config.EMAIL_FROM,
            }),
    },
  ],
  exports: [EMAIL_ADAPTER],
})
export class EmailModule {}
