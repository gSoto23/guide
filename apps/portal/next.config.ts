import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

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
