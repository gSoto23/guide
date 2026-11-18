import { Module } from "@nestjs/common";
import { PushController } from "./push.controller.js";
import { PushService } from "./push.service.js";

/** A member's push devices (feature 006 US4). */
@Module({ controllers: [PushController], providers: [PushService] })
export class PushModule {}
