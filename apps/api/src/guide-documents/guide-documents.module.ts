import { Module } from "@nestjs/common";
import { GuidesModule } from "../guides/guides.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { UploadsModule } from "../uploads/uploads.module.js";
import { GuideDocumentsController } from "./guide-documents.controller.js";
import { GuideDocumentsService } from "./guide-documents.service.js";

/** Manuals and photos read for knowledge (feature 003 US6, research R9). */
@Module({
  imports: [TenancyModule, GuidesModule, UploadsModule],
  controllers: [GuideDocumentsController],
  providers: [GuideDocumentsService],
})
export class GuideDocumentsModule {}
