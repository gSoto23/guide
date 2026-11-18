import { Module } from "@nestjs/common";
import { GuidesModule } from "../guides/guides.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { ExploreCoreModule } from "./explore-core.module.js";
import { PropertyExploreController, WorkspaceExploreController } from "./explore.controller.js";
import { ExploreService } from "./explore.service.js";

/** Explore settings for members (feature 009 US2); the guest routes live in the guest module. */
@Module({
  imports: [TenancyModule, GuidesModule, ExploreCoreModule],
  controllers: [WorkspaceExploreController, PropertyExploreController],
  providers: [ExploreService],
})
export class ExploreModule {}
