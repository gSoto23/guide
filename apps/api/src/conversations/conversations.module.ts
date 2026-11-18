import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { AssistantSettingsService } from "./assistant-settings.service.js";
import {
  AssistantSettingsController,
  ConversationsController,
} from "./conversations.controller.js";
import { ConversationsService } from "./conversations.service.js";

/** The member side of the in-guide chat (feature 005 research R11). */
@Module({
  imports: [TenancyModule],
  controllers: [ConversationsController, AssistantSettingsController],
  providers: [ConversationsService, AssistantSettingsService],
})
export class ConversationsModule {}
