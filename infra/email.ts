/**
 * Amazon SES sender identity (ADR-0009, research R9).
 * Created only when GUIDESK_EMAIL_SENDER is set (a domain or address). New SES accounts start in
 * the sandbox; request production access before the pilot.
 *
 * A stage without a domain yet (staging before the brand domain, OQ-11) can use a single address:
 * SES verifies it with a link it emails to that address, and DMARC and DKIM records only exist for
 * a domain sender.
 */
import { stageConfig } from "./config";

const sender = stageConfig.emailSender;

export const email = sender
  ? new sst.aws.Email("Email", {
      sender,
      ...(sender.includes("@") ? {} : { dmarc: "v=DMARC1; p=quarantine; adkim=s; aspf=s;" }),
    })
  : undefined;
