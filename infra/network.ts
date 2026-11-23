/**
 * One VPC with public and private subnets in two availability zones (ADR-0009).
 * NAT for outbound calls (Claude API, Tilopay, PMS APIs): fck-nat instances during the pilot,
 * managed NAT gateways before the public launch (`stageConfig.nat`).
 * A bastion is available outside production for database access through SSM.
 */
import { isProduction, stageConfig } from "./config";

export const vpc = new sst.aws.Vpc("Vpc", {
  az: 2,
  nat: stageConfig.nat,
  bastion: !isProduction,
});
