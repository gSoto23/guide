import { Global, Module } from "@nestjs/common";
import { AccountDeletionService } from "../account/account-deletion.service.js";
import { AssuranceService } from "../auth/assurance.service.js";
import { DeviceService } from "../auth/device.service.js";
import { LockoutNoticeService } from "../auth/lockout-notice.service.js";
import { LockoutService } from "../auth/lockout.service.js";
import { MfaGuard, StepUpGuard } from "../auth/step-up.guard.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { OutboxService } from "../notifications/outbox.service.js";
import { ActivePropertyCount } from "../properties/property-count.provider.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { PROPERTY_COUNT } from "../tenancy/property-count.js";
import { TenancyService } from "../tenancy/tenancy.service.js";

/** Account protection building blocks shared by every module (US2). */
@Global()
@Module({
  providers: [
    SecurityLogService,
    RateLimitService,
    JobQueueService,
    OutboxService,
    LockoutService,
    LockoutNoticeService,
    AccountDeletionService,
    AssuranceService,
    DeviceService,
    TenancyService,
    StepUpGuard,
    MfaGuard,
    // Feature 002: the real count of active properties (FR-048, T025).
    { provide: PROPERTY_COUNT, useClass: ActivePropertyCount },
  ],
  exports: [
    SecurityLogService,
    RateLimitService,
    JobQueueService,
    OutboxService,
    LockoutService,
    LockoutNoticeService,
    AccountDeletionService,
    AssuranceService,
    DeviceService,
    TenancyService,
    StepUpGuard,
    MfaGuard,
    PROPERTY_COUNT,
  ],
})
export class SecurityModule {}
