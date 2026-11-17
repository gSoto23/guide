import { Global, Module } from "@nestjs/common";
import { API_CONFIG } from "../config/config.js";
import { createObjectStorage, OBJECT_STORAGE } from "./storage.provider.js";
import { UploadsService } from "./uploads.service.js";

/** Presigned uploads to the uploads bucket (research R9), shared by extractions and CSV imports. */
@Global()
@Module({
  providers: [
    { provide: OBJECT_STORAGE, inject: [API_CONFIG], useFactory: createObjectStorage },
    UploadsService,
  ],
  exports: [OBJECT_STORAGE, UploadsService],
})
export class UploadsModule {}
