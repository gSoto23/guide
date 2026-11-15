/**
 * Property count per workspace, used by the MFA threshold (T055). Feature 002 provides the real
 * implementation; until then every workspace has 0 properties, so the threshold never applies.
 */
export interface PropertyCountProvider {
  countProperties(workspaceId: string): Promise<number>;
}

export const noPropertiesYet: PropertyCountProvider = {
  countProperties: async () => 0,
};
