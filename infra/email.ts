/**
 * Amazon SES sender identity (ADR-0009, research R9).
 * Created only when GUIDESK_EMAIL_SENDER is set (a domain or address). New SES accounts start in
 * the sandbox; request production access before the pilot.
 */
import { stageConfig } from "./config";

export const email = stageConfig.emailSender
  ? new sst.aws.Email("Email", {
      sender: stageConfig.emailSender,
      dmarc: "v=DMARC1; p=quarantine; adkim=s; aspf=s;",
    })
  : undefined;
