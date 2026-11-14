"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

/**
 * Better Auth client (ADR-0008). Calls same-origin /api/auth/* (CloudFront in AWS, the Next.js
 * rewrite locally), so cookies stay host-only on the portal domain.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [emailOTPClient(), passkeyClient(), twoFactorClient()],
});
