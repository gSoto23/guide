import { Global, Module } from "@nestjs/common";
import { noPropertiesYet } from "@guidesk/domain";
import { AccountDeletionService } from "../account/account-deletion.service.js";
import { AssuranceService } from "../auth/assurance.service.js";
import { DeviceService } from "../auth/device.service.js";
import { LockoutNoticeService } from "../auth/lockout-notice.service.js";
import { LockoutService } from "../auth/lockout.service.js";
import { MfaGuard, StepUpGuard } from "../auth/step-up.guard.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { OutboxService } from "../notifications/outbox.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { PROPERTY_COUNT } from "../tenancy/property-count.js";
import { TenancyService } from "../tenancy/tenancy.service.js";

/** Account protection building blocks shared by every module (US2). */
@Global()
@Module({
  providers: [
    SecurityLogService,
    RateLimitService,
    OutboxService,
    LockoutService,
    LockoutNoticeService,
    AccountDeletionService,
    AssuranceService,
    DeviceService,
    TenancyService,
    StepUpGuard,
    MfaGuard,
    { provide: PROPERTY_COUNT, useValue: noPropertiesYet },
  ],
  exports: [
    SecurityLogService,
    RateLimitService,
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
