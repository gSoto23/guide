import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Locally, settings such as API_PROXY_URL live in the repository's .env (README). Variables already
// in the environment win, and CI and AWS have no such file.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  // No .env: use the environment as it is.
}

// Precompiled ICU messages keep the message parser out of the browser bundle (T101).
const withNextIntl = createNextIntlPlugin({
  requestConfig: "./i18n/request.ts",
  experimental: {
    messages: {
      path: "../../packages/i18n/messages",
      format: "json",
      locales: ["es", "en"],
      precompile: true,
    },
  },
});

// In AWS, CloudFront routes /api/* to the API load balancer (ADR-0009, research R2). Locally,
// API_PROXY_URL (for example http://localhost:4000) makes Next.js forward /api/* the same way,
// so the browser always talks to one origin and cookies stay host-only.
const apiProxy = process.env.API_PROXY_URL;

const production = process.env.NODE_ENV === "production";

/** Headers for every portal response (SEC-11, security review T103). The CSP is set in proxy.ts. */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), " +
      "publickey-credentials-get=(self), publickey-credentials-create=(self)",
  },
  ...(production
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  ...(apiProxy
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${apiProxy}/api/:path*` }];
        },
      }
    : {}),
};

export default withNextIntl(nextConfig);
