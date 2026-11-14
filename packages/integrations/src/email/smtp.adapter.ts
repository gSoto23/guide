import nodemailer, { type Transporter } from "nodemailer";
import type { EmailAdapter, EmailMessage, EmailSendResult } from "./port.js";

export interface SmtpAdapterOptions {
  host: string;
  port: number;
  from: string;
}

/** SMTP adapter for local development and tests (Mailpit). */
export class SmtpEmailAdapter implements EmailAdapter {
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpAdapterOptions) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: false,
    });
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const info = await this.transporter.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: { "X-Guidesk-Template": message.template },
    });
    return { messageId: String(info.messageId) };
  }
}
