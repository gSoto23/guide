import { Module } from "@nestjs/common";
import { GuestModule } from "../guest/guest.module.js";
import { GuestChatController } from "./guest-chat.controller.js";
import { GuestChatService } from "./guest-chat.service.js";

/** The guest side of the in-guide chat (feature 005 research R1, R7). */
@Module({
  imports: [GuestModule],
  controllers: [GuestChatController],
  providers: [GuestChatService],
})
export class ChatModule {}
