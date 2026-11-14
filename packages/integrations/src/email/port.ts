/** Transactional email port (NotificationPort, research R9). */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Template ID from contracts/emails.md, for metrics and logs. */
  template: string;
}

export interface EmailSendResult {
  messageId: string;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
