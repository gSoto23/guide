import { Global, Module } from "@nestjs/common";
import { API_CONFIG } from "../config/config.js";
import { createMediaStorage, MEDIA_STORAGE } from "./media.provider.js";
import { createObjectStorage, OBJECT_STORAGE } from "./storage.provider.js";
import { UploadsService } from "./uploads.service.js";

/** Presigned uploads to the uploads bucket (research R9), shared by extractions and CSV imports. */
@Global()
@Module({
  providers: [
    { provide: OBJECT_STORAGE, inject: [API_CONFIG], useFactory: createObjectStorage },
    // Feature 003: guide images and videos (research R9).
    { provide: MEDIA_STORAGE, inject: [API_CONFIG], useFactory: createMediaStorage },
    UploadsService,
  ],
  exports: [OBJECT_STORAGE, MEDIA_STORAGE, UploadsService],
})
export class UploadsModule {}
