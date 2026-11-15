/**
 * Header the auth route sets with the client address it trusts (security review T103). Fastify
 * computes that address from the connection and X-Forwarded-For, counting only the configured
 * number of proxy hops (CloudFront and the load balancer in AWS). Any client-sent value is
 * overwritten, so rate limits can't be dodged or pinned on someone else.
 */
export const CLIENT_IP_HEADER = "x-guidesk-client-ip";
