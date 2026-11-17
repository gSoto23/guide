/**
 * Private uploads bucket for listing screenshots and CSV files (feature 002, research R9,
 * SEC-10, SEC-11). Browsers upload straight to it with presigned POST forms; the file processor
 * reads and deletes each object right after processing, and a lifecycle rule deletes anything
 * left after 1 day (FR-015). GuardDuty Malware Protection scans every object; findings go to the
 * operations alert topic. Scans do not block processing, because these files are never served
 * and images are decoded and re-encoded before use.
 */
import { opsAlerts } from "./alerts";
import { portalUrl } from "./router";

export const uploads = new sst.aws.Bucket("Uploads", {
  cors: {
    allowOrigins: [portalUrl],
    allowMethods: ["POST"],
    allowHeaders: ["*"],
    maxAge: "1 hour",
  },
  lifecycle: [{ id: "delete-after-1-day", expiresIn: "1 day" }],
  transform: {
    publicAccessBlock: (args) => {
      args.blockPublicAcls = true;
      args.blockPublicPolicy = true;
      args.ignorePublicAcls = true;
      args.restrictPublicBuckets = true;
    },
  },
});

// SSE-KMS with the account's S3 key, so GuardDuty and the file processor can read objects
// through S3 without access to the restricted-data key.
new aws.s3.BucketServerSideEncryptionConfiguration("UploadsEncryption", {
  bucket: uploads.name,
  rules: [
    {
      applyServerSideEncryptionByDefault: { sseAlgorithm: "aws:kms" },
      bucketKeyEnabled: true,
    },
  ],
});

const malwareScanRole = new aws.iam.Role("UploadsMalwareScanRole", {
  assumeRolePolicy: aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        actions: ["sts:AssumeRole"],
        principals: [
          { type: "Service", identifiers: ["malware-protection-plan.guardduty.amazonaws.com"] },
        ],
      },
    ],
  }).json,
});

const account = aws.getCallerIdentityOutput({});
const region = aws.getRegionOutput({});
const guardDutyRules = $interpolate`arn:aws:events:${region.region}:${account.accountId}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`;

// The permissions GuardDuty documents for a Malware Protection plan on one bucket.
new aws.iam.RolePolicy("UploadsMalwareScanPolicy", {
  role: malwareScanRole.id,
  policy: aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        sid: "ManageScanEventRules",
        actions: [
          "events:PutRule",
          "events:DeleteRule",
          "events:PutTargets",
          "events:RemoveTargets",
        ],
        resources: [guardDutyRules],
        conditions: [
          {
            test: "StringLike",
            variable: "events:ManagedBy",
            values: ["malware-protection-plan.guardduty.amazonaws.com"],
          },
        ],
      },
      {
        sid: "ReadScanEventRules",
        actions: ["events:DescribeRule", "events:ListTargetsByRule"],
        resources: [guardDutyRules],
      },
      {
        sid: "BucketNotifications",
        actions: [
          "s3:PutBucketNotification",
          "s3:GetBucketNotification",
          "s3:GetBucketLocation",
          "s3:ListBucket",
        ],
        resources: [uploads.arn],
      },
      {
        sid: "ScanAndTagObjects",
        actions: [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:GetObjectTagging",
          "s3:GetObjectVersionTagging",
          "s3:PutObjectTagging",
          "s3:PutObjectVersionTagging",
        ],
        resources: [$interpolate`${uploads.arn}/*`],
      },
      {
        sid: "ValidationObject",
        actions: ["s3:PutObject"],
        resources: [$interpolate`${uploads.arn}/malware-protection-resource-validation-object`],
      },
      {
        sid: "DecryptThroughS3",
        actions: ["kms:GenerateDataKey", "kms:Decrypt"],
        resources: ["*"],
        conditions: [
          {
            test: "StringLike",
            variable: "kms:ViaService",
            values: [$interpolate`s3.${region.region}.amazonaws.com`],
          },
        ],
      },
    ],
  }).json,
});

new aws.guardduty.MalwareProtectionPlan("UploadsMalwareScan", {
  role: malwareScanRole.arn,
  protectedResource: { s3Bucket: { bucketName: uploads.name } },
  actions: [{ taggings: [{ status: "ENABLED" }] }],
});

const threatsFound = new aws.cloudwatch.EventRule("UploadsThreatsFound", {
  description: "GuardDuty found malware in the uploads bucket (research R9)",
  eventPattern: $jsonStringify({
    source: ["aws.guardduty"],
    "detail-type": ["GuardDuty Malware Protection Object Scan Result"],
    detail: {
      s3ObjectDetails: { bucketName: [uploads.name] },
      scanResultDetails: { scanResultStatus: ["THREATS_FOUND"] },
    },
  }),
});

new aws.cloudwatch.EventTarget("UploadsThreatsFoundAlert", {
  rule: threatsFound.name,
  arn: opsAlerts.arn,
});
