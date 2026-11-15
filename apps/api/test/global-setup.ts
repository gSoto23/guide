import type { TestProject } from "vitest/node";
import { startTestDatabase } from "@guidesk/testing";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** One disposable PostgreSQL (with migrations) for the API integration suite (T029). */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await startTestDatabase();
  project.provide("databaseUrl", database.url);
  return () => database.stop();
}
