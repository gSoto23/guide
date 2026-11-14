import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { EmailAdapter, EmailMessage, EmailSendResult } from "./port.js";

export interface SesAdapterOptions {
  from: string;
  configurationSetName?: string | undefined;
  client?: SESv2Client;
}

/** Amazon SES adapter (ADR-0009). Credentials come from the ECS task role. */
export class SesEmailAdapter implements EmailAdapter {
  private readonly client: SESv2Client;

  constructor(private readonly options: SesAdapterOptions) {
    this.client = options.client ?? new SESv2Client({ region: "us-east-1" });
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const output = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.options.from,
        Destination: { ToAddresses: [message.to] },
        ConfigurationSetName: this.options.configurationSetName,
        EmailTags: [{ Name: "template", Value: message.template.replace(/[^A-Za-z0-9_-]/g, "_") }],
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: message.html, Charset: "UTF-8" },
              Text: { Data: message.text, Charset: "UTF-8" },
            },
          },
        },
      }),
    );
    if (!output.MessageId) {
      throw new Error("SES did not return a MessageId");
    }
    return { messageId: output.MessageId };
  }
}
