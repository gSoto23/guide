import * as scenes from "./data.js";
import type { IllustrationData } from "./data.js";

/** Every illustration by name, for server-side code and tests (client code imports one scene). */
export const ILLUSTRATIONS = {
  door: scenes.doorScene,
  welcome: scenes.welcomeScene,
  noProperties: scenes.noPropertiesScene,
  inboxClear: scenes.inboxClearScene,
  noRequests: scenes.noRequestsScene,
  noData: scenes.noDataScene,
  offline: scenes.offlineScene,
  unavailable: scenes.unavailableScene,
  wait: scenes.waitScene,
} as const satisfies Record<string, IllustrationData>;

export type IllustrationName = keyof typeof ILLUSTRATIONS;
