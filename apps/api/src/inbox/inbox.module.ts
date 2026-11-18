import { Module } from "@nestjs/common";
import { ConversationsService } from "../conversations/conversations.service.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import {
  ConversationActionsController,
  CopilotController,
  InboxController,
} from "./inbox.controller.js";
import { InboxService } from "./inbox.service.js";

/** The host inbox, conversation actions, and the copilot (feature 006). */
@Module({
  imports: [TenancyModule],
  controllers: [InboxController, ConversationActionsController, CopilotController],
  providers: [InboxService, ConversationsService],
})
export class InboxModule {}
