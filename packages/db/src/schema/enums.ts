/**
 * Enum values shared by more than one schema file. They live here, with no imports, so that
 * schema files that reference each other never read a constant before it is initialized (plain
 * Node ESM evaluates circular imports in order; a constant used at module load must not be part
 * of a cycle).
 */
export const PMS_PROVIDERS = ["beds24", "hostex"] as const;
