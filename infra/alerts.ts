/**
 * Operations alert topic (feature 002, research R9). GuardDuty malware findings on the uploads
 * bucket are published here. Set GUIDESK_ALERT_EMAIL to subscribe an inbox; the subscription must
 * be confirmed from the email AWS sends.
 */
export const opsAlerts = new aws.sns.Topic("OpsAlerts");

if (process.env.GUIDESK_ALERT_EMAIL) {
  new aws.sns.TopicSubscription("OpsAlertsEmail", {
    topic: opsAlerts.arn,
    protocol: "email",
    endpoint: process.env.GUIDESK_ALERT_EMAIL,
  });
}

// EventBridge delivers GuardDuty scan results to the topic.
new aws.sns.TopicPolicy("OpsAlertsPolicy", {
  arn: opsAlerts.arn,
  policy: aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        actions: ["sns:Publish"],
        principals: [{ type: "Service", identifiers: ["events.amazonaws.com"] }],
        resources: [opsAlerts.arn],
      },
    ],
  }).json,
});
