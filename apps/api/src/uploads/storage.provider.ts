import { LocalObjectStorage, S3ObjectStorage, type ObjectStoragePort } from "@guidesk/integrations";
import type { ApiConfig } from "../config/config.js";

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

/** The development-only upload route that stands in for S3 (STORAGE_MODE=local). */
export const LOCAL_UPLOAD_PATH = "/api/v1/local-uploads";

/**
 * S3 in AWS; a local folder in development and test. The local form posts through the portal's
 * origin, which forwards /api/* to the API, like CloudFront does in AWS.
 */
export function createObjectStorage(config: ApiConfig): ObjectStoragePort {
  const storage = config.integrations.storage;
  return storage.mode === "s3"
    ? new S3ObjectStorage({ bucket: storage.bucket })
    : new LocalObjectStorage({
        dir: storage.dir,
        uploadUrl: new URL(LOCAL_UPLOAD_PATH, config.PORTAL_URL).toString(),
      });
}
