import type { TestProject } from "vitest/node";
import { startTestDatabase } from "@guidesk/testing";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** A disposable PostgreSQL with every migration applied, for the worker's job tests. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await startTestDatabase();
  project.provide("databaseUrl", database.url);
  return database.stop;
}
