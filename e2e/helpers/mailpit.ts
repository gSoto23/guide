/** Reads emails captured by Mailpit (docker-compose.yml) through its REST API. */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

interface MailpitSummary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Created: string;
}

export async function latestMessageTo(
  address: string,
  timeoutMs = 15_000,
): Promise<{ subject: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=1`,
    );
    const body = (await response.json()) as { messages: MailpitSummary[] };
    const summary = body.messages[0];
    if (summary) {
      const message = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${summary.ID}`)
      ).json()) as {
        Subject: string;
        Text: string;
      };
      return { subject: message.Subject, text: message.Text };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email for ${address} within ${timeoutMs} ms`);
}

/** Extracts the 6-digit one-time code from the latest email to an address. */
export async function latestCodeFor(address: string): Promise<string> {
  const { text } = await latestMessageTo(address);
  const code = text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No 6-digit code in the latest email to ${address}`);
  return code;
}

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
}

/** Waits for an email to an address whose subject contains the given text. */
export async function waitForSubject(
  address: string,
  subject: string,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const query = encodeURIComponent(`to:${address} subject:"${subject}"`);
    const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=1`);
    const body = (await response.json()) as { messages: MailpitSummary[] };
    if (body.messages[0]) return body.messages[0].Subject;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email "${subject}" for ${address} within ${timeoutMs} ms`);
}
