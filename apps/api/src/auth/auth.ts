import { betterAuth } from "better-auth";
import { buildAuthOptions, type AuthDependencies } from "./options.js";

export function createAuth(dependencies: AuthDependencies) {
  return betterAuth(buildAuthOptions(dependencies));
}

export type GuideskAuth = ReturnType<typeof createAuth>;

export const AUTH_INSTANCE = Symbol("AUTH_INSTANCE");
export const AUTH_PROVIDER = Symbol("AUTH_PROVIDER");
