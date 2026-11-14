/**
 * CloudFront in front of the portal, with AWS WAF (ADR-0009, SEC-07, SEC-11).
 * `/api/*` goes to the API load balancer so the browser sees a single origin and cookies stay
 * host-only on the portal domain.
 */
import { router } from "./router";
import { api } from "./services";

export { router };

router.route("/api", api.url);

export const portal = new sst.aws.Nextjs("Portal", {
  path: "apps/portal",
  router: { instance: router },
  server: {
    architecture: "arm64",
  },
});
