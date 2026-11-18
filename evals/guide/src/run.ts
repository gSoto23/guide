/**
 * Guide builder eval runner (feature 003 research R6, constitution V). The drafting, interview,
 * and translation suites are added with the user stories that introduce each AI call (T058,
 * T092, T102). Every change to a guide prompt, schema, model, or effort must pass them before
 * merge.
 */
const SUITES = ["drafting", "interview", "translation"] as const;

export type Suite = (typeof SUITES)[number];

console.log(`Guide eval suites: ${SUITES.join(", ")} (no cases yet).`);
