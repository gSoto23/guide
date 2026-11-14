/**
 * One VPC with public and private subnets in two availability zones (ADR-0009).
 * A managed NAT gateway handles outbound calls (Claude API, Tilopay, PMS APIs).
 * A bastion is available outside production for database access through SSM.
 */
import { isProduction } from "./config";

export const vpc = new sst.aws.Vpc("Vpc", {
  az: 2,
  nat: "managed",
  bastion: !isProduction,
});
