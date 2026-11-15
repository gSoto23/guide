// Loaded first by main.ts so instrumentation patches modules before they are imported (T025).
import { initObservability } from "@guidesk/observability";

initObservability("guidesk-worker");
