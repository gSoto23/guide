import { Module } from "@nestjs/common";
import { MeController } from "./me.controller.js";
import { MeService } from "./me.service.js";
import { OnboardingReportService } from "./onboarding-report.js";
import { OnboardingService } from "./onboarding.service.js";
import { StepUpController } from "./step-up.controller.js";

@Module({
  controllers: [MeController, StepUpController],
  providers: [MeService, OnboardingService, OnboardingReportService],
  exports: [OnboardingReportService],
})
export class AccountModule {}
