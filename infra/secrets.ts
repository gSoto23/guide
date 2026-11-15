/**
 * Secrets stored by SST in AWS (set with `pnpm sst secret set <Name> <value> --stage <stage>`).
 * Values never live in the repository (constitution, Principle VI).
 */
export const betterAuthSecret = new sst.Secret("BetterAuthSecret");
export const googleClientId = new sst.Secret("GoogleClientId");
export const googleClientSecret = new sst.Secret("GoogleClientSecret");
/** Shared secret that only requests coming through CloudFront carry (research R7). */
export const edgeSharedSecret = new sst.Secret("EdgeSharedSecret");

export const allSecrets = [betterAuthSecret, googleClientId, googleClientSecret, edgeSharedSecret];
