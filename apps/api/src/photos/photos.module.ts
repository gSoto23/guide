import { Module } from "@nestjs/common";
import { UploadsModule } from "../uploads/uploads.module.js";
import { PhotosService } from "./photos.service.js";

/** Property covers and extras photos (feature 016). */
@Module({
  imports: [UploadsModule],
  providers: [PhotosService],
  exports: [PhotosService],
})
export class PhotosModule {}
