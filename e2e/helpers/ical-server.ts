/**
 * The local iCal fixture server (feature 002 T065, quickstart 7), shared with the API and worker
 * tests through @guidesk/testing. Run it on its own for manual testing:
 *
 *   node e2e/helpers/ical-server.ts
 *
 * then start the API and worker with SANDBOX_TEST_ALLOW_HOST=localhost and SANDBOX_TEST_CA_FILE
 * set to the printed CA file. Both settings are refused in production (research R2).
 */
import { fileURLToPath } from "node:url";
import { startIcalServer } from "@guidesk/testing/ical-server";

export {
  icsCalendar,
  startIcalServer,
  type CalendarEvent,
  type IcalServer,
} from "@guidesk/testing/ical-server";

/** Test-only certificates live in e2e/.certs (git-ignored). */
export const CERTIFICATE_DIR = fileURLToPath(new URL("../.certs", import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startIcalServer(CERTIFICATE_DIR);
  const today = new Date();
  const day = (offset: number) =>
    new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  server.setFeed("airbnb", [
    { uid: "res-1@fixture.test", start: day(3), end: day(6), summary: "Reserved" },
    {
      uid: "block-1@fixture.test",
      start: day(10),
      end: day(12),
      summary: "Airbnb (Not available)",
    },
    { uid: "open-1@fixture.test", start: day(20), end: day(23), summary: "CLOSED - Not available" },
  ]);
  console.warn(`iCal fixture server: ${server.url("airbnb")}`);
  console.warn(`SANDBOX_TEST_ALLOW_HOST=${server.host} SANDBOX_TEST_CA_FILE=${server.caFile}`);
}
