import { z } from "zod";

/** Contracts for /api/v1/me and /api/v1/me/onboarding (contracts/http-api.md, T041, T042). */
export const languageSchema = z.enum(["es", "en"]);

export const membershipSummarySchema = z.object({
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  role: z.enum(["owner", "admin", "agent"]),
  status: z.enum(["active", "pending_deletion"]),
});

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.email(),
    name: z.string(),
    preferredLanguage: languageSchema,
  }),
  memberships: z.array(membershipSummarySchema),
  lastWorkspaceId: z.uuid().nullable(),
  mfa: z.object({ enabled: z.boolean() }),
  /** Workspaces where the user must use a second factor (filled by US2, T054). */
  requiresMfaIn: z.array(z.uuid()),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    preferredLanguage: languageSchema.optional(),
  })
  .strict()
  .refine((body) => body.name !== undefined || body.preferredLanguage !== undefined, {
    message: "Provide name or preferredLanguage",
  });
export type UpdateMeBody = z.infer<typeof updateMeSchema>;

export const PROPERTIES_BUCKET_VALUES = ["1_2", "3_10", "10_plus"] as const;
export const PMS_VALUES = [
  "hostaway",
  "guesty",
  "hospitable",
  "smoobu",
  "ownerrez",
  "hostfully",
  "beds24",
  "hostex",
  "lodgify",
  "uplisting",
  "stays_net",
  "other",
  "none",
] as const;

export const onboardingBodySchema = z
  .object({
    propertiesBucket: z.enum(PROPERTIES_BUCKET_VALUES).nullable().optional(),
    pms: z.enum(PMS_VALUES).nullable().optional(),
    pmsOther: z.string().trim().min(1).max(80).nullable().optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/, "Use an ISO 3166-1 alpha-2 code")
      .nullable()
      .optional(),
    skipped: z.boolean().optional(),
  })
  .strict()
  .refine((body) => body.pmsOther == null || body.pms === "other", {
    message: "pmsOther is only allowed when pms is other",
    path: ["pmsOther"],
  })
  .refine((body) => body.pms !== "other" || Boolean(body.pmsOther), {
    message: "pmsOther is required when pms is other",
    path: ["pmsOther"],
  });
export type OnboardingBody = z.infer<typeof onboardingBodySchema>;

export const onboardingResponseSchema = z.object({
  propertiesBucket: z.enum(PROPERTIES_BUCKET_VALUES).nullable(),
  pms: z.enum(PMS_VALUES).nullable(),
  pmsOther: z.string().nullable(),
  country: z.string().nullable(),
  skipped: z.boolean(),
  path: z.enum(["individual", "manager"]),
  answeredAt: z.iso.datetime().nullable(),
});
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>;

/** Step-up by email code within the current session (FR-011). Passkey and TOTP step-up use the
 * auth endpoints (/api/auth/passkey/*, /api/auth/two-factor/verify-totp). */
export const stepUpChallengeSchema = z.object({ method: z.literal("email_otp") }).strict();
export type StepUpChallengeBody = z.infer<typeof stepUpChallengeSchema>;

export const stepUpVerifySchema = z
  .object({
    method: z.literal("email_otp"),
    code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  })
  .strict();
export type StepUpVerifyBody = z.infer<typeof stepUpVerifySchema>;
