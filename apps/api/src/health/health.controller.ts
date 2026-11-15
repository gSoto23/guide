import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";

export interface HealthStatus {
  status: "ok";
}

/** Liveness endpoint used by the load balancer health check (ADR-0009). */
@Controller("health")
export class HealthController {
  @Public()
  @Get()
  check(): HealthStatus {
    return { status: "ok" };
  }
}
