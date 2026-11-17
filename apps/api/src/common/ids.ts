import { ApiProblem } from "./problem.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path ID that is not a UUID names nothing: 404, instead of a database error. */
export function assertUuid(value: string): void {
  if (!UUID.test(value)) throw new ApiProblem(404, "not_found");
}
