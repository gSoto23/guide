import { Module } from "@nestjs/common";
import { GuidesModule } from "../guides/guides.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { UploadsModule } from "../uploads/uploads.module.js";
import { InterviewsController } from "./interviews.controller.js";
import { InterviewsService } from "./interviews.service.js";

/** The AI interview (feature 003 US4, research R11). */
@Module({
  imports: [TenancyModule, GuidesModule, UploadsModule],
  controllers: [InterviewsController],
  providers: [InterviewsService],
})
export class InterviewsModule {}
