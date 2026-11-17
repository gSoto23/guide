import { Module } from "@nestjs/common";
import { PropertiesModule } from "../properties/properties.module.js";
import { ListingContentController } from "./listing-content.controller.js";
import { ListingContentService } from "./listing-content.service.js";

/** Listing content review, shared by listing text, PMS imports, and duplicates (T028). */
@Module({
  imports: [PropertiesModule],
  controllers: [ListingContentController],
  providers: [ListingContentService],
  exports: [ListingContentService],
})
export class ListingContentModule {}
