import { Module } from "@nestjs/common";
import { ExploreSelection } from "./explore-selection.js";

/** What guests and members see in Explore (feature 009); shared by the guest and member routes. */
@Module({ providers: [ExploreSelection], exports: [ExploreSelection] })
export class ExploreCoreModule {}
