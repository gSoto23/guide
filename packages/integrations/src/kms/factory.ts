import type { IntegrationSettings } from "../settings.js";
import { AwsKeyManagement } from "./aws-kms.adapter.js";
import { LocalKeyManagement } from "./local.adapter.js";
import type { KeyManagementPort } from "./port.js";

/**
 * The key management adapter for the configured `KMS_MODE` (research R5). Settings already refuse
 * `local` in production, so the API and the worker build the same adapter from the same settings.
 */
export function createKeyManagement(settings: IntegrationSettings["kms"]): KeyManagementPort {
  return settings.mode === "aws"
    ? new AwsKeyManagement({ keyId: settings.keyId })
    : new LocalKeyManagement(settings.localKey);
}
