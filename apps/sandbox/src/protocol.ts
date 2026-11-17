/**
 * The sandbox wire protocol (research R2): request and response schemas shared with
 * `SandboxPort` in `@guidesk/integrations`. The protocol entry carries Zod only, so the functions
 * do not bundle the provider SDKs of the main entry.
 */
export * from "@guidesk/integrations/sandbox-protocol";
