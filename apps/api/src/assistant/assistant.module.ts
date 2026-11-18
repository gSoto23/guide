import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import {
  PropertyAssistantController,
  WorkspaceAssistantController,
} from "./assistant.controller.js";
import { AssistantService } from "./assistant.service.js";

/** The assistant's settings and tests (feature 007); replaces feature 005's settings routes. */
@Module({
  imports: [TenancyModule],
  controllers: [WorkspaceAssistantController, PropertyAssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
