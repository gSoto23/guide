/**
 * Customer-managed KMS key for restricted data (feature 002, research R5, SEC-06). It wraps one
 * data key per workspace; values are encrypted with those data keys, never with KMS directly.
 * The key policy, which names the API and worker task roles, is attached in services.ts once
 * those roles exist.
 */
import { isProduction } from "./config";

export const restrictedDataKey = new aws.kms.Key("RestrictedDataKey", {
  description: "Guidesk restricted data: wraps the per-workspace data keys (research R5)",
  keyUsage: "ENCRYPT_DECRYPT",
  customerMasterKeySpec: "SYMMETRIC_DEFAULT",
  enableKeyRotation: true,
  rotationPeriodInDays: 365,
  deletionWindowInDays: isProduction ? 30 : 7,
});

new aws.kms.Alias("RestrictedDataKeyAlias", {
  name: `alias/guidesk-${$app.stage}-restricted-data`,
  targetKeyId: restrictedDataKey.keyId,
});

const account = aws.getCallerIdentityOutput({});

/**
 * The key policy: the account may administer the key but not use it, and only the given roles
 * may generate and unwrap data keys, and only with a `workspace_id` encryption context.
 */
export function restrictedDataKeyPolicy(userRoleArns: $util.Input<string>[]) {
  return aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: "AccountAdministersButDoesNotUse",
        principals: [
          { type: "AWS", identifiers: [$interpolate`arn:aws:iam::${account.accountId}:root`] },
        ],
        actions: [
          "kms:Create*",
          "kms:Describe*",
          "kms:Enable*",
          "kms:List*",
          "kms:Put*",
          "kms:Update*",
          "kms:Revoke*",
          "kms:Disable*",
          "kms:Get*",
          "kms:Delete*",
          "kms:TagResource",
          "kms:UntagResource",
          "kms:ScheduleKeyDeletion",
          "kms:CancelKeyDeletion",
          "kms:RotateKeyOnDemand",
        ],
        resources: ["*"],
      },
      {
        sid: "ServicesUseDataKeysPerWorkspace",
        principals: [{ type: "AWS", identifiers: userRoleArns }],
        actions: ["kms:GenerateDataKey", "kms:Decrypt"],
        resources: ["*"],
        conditions: [
          {
            test: "ForAnyValue:StringEquals",
            variable: "kms:EncryptionContextKeys",
            values: ["workspace_id"],
          },
        ],
      },
    ],
  }).json;
}
