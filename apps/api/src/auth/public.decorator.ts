import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "guidesk:isPublic";

/** Marks a route that does not require a session (for example the health check). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
