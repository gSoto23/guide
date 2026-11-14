import { Module } from "@nestjs/common";
import { CrossTenantService } from "./cross-tenant.js";
import { InvitationAcceptController } from "./invitation-accept.controller.js";
import { InvitationAcceptService } from "./invitation-accept.service.js";
import { InvitationsController } from "./invitations.controller.js";
import { InvitationEvents } from "./invitations.events.js";
import { InvitationsService } from "./invitations.service.js";
import { MembersController } from "./members.controller.js";
import { PilotSeatLimitProvider, SEAT_LIMIT } from "./seat-limit.js";
import { WorkspaceAccessGuard } from "./workspace-access.guard.js";
import { WorkspacesController } from "./workspaces.controller.js";

/** Workspaces, members, and invitations (spec 001 US3, US4). */
@Module({
  controllers: [
    WorkspacesController,
    InvitationsController,
    InvitationAcceptController,
    MembersController,
  ],
  providers: [
    InvitationsService,
    InvitationAcceptService,
    InvitationEvents,
    CrossTenantService,
    WorkspaceAccessGuard,
    { provide: SEAT_LIMIT, useClass: PilotSeatLimitProvider },
  ],
})
export class TenancyModule {}
