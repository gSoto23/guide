import { Module } from "@nestjs/common";
import { AccountController } from "./account.controller.js";
import { EmailChangeService } from "./email-change.service.js";
import { ExportService } from "./export.service.js";
import { MeController } from "./me.controller.js";
import { SecurityLogController } from "../security-log/security-log.controller.js";
import { MeService } from "./me.service.js";
import { OnboardingReportService } from "./onboarding-report.js";
import { OnboardingService } from "./onboarding.service.js";
import { StepUpController } from "./step-up.controller.js";

@Module({
  controllers: [MeController, StepUpController, AccountController, SecurityLogController],
  providers: [
    MeService,
    OnboardingService,
    OnboardingReportService,
    ExportService,
    EmailChangeService,
  ],
  exports: [OnboardingReportService],
})
export class AccountModule {}
