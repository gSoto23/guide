import { Global, Module } from "@nestjs/common";
import { BetterAuthAdapter, type AuthProviderPort, type EmailAdapter } from "@guidesk/integrations";
import type { DbHandle } from "@guidesk/db";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { DB_HANDLE } from "../database/database.module.js";
import { EMAIL_ADAPTER } from "../email/email.module.js";
import { AUTH_INSTANCE, AUTH_PROVIDER, createAuth, type GuideskAuth } from "./auth.js";
import { AuthEventsService } from "./auth-events.service.js";
import { createOtpSender } from "./otp-sender.js";
import { StepUpService } from "./step-up.service.js";

@Global()
@Module({
  providers: [
    AuthEventsService,
    StepUpService,
    {
      provide: AUTH_INSTANCE,
      inject: [DB_HANDLE, API_CONFIG, EMAIL_ADAPTER, AuthEventsService],
      useFactory: (
        handle: DbHandle,
        config: ApiConfig,
        email: EmailAdapter,
        events: AuthEventsService,
      ): GuideskAuth =>
        createAuth({ db: handle.db, config, sendOtp: createOtpSender(email, handle.db), events }),
    },
    {
      provide: AUTH_PROVIDER,
      inject: [AUTH_INSTANCE],
      useFactory: (auth: GuideskAuth): AuthProviderPort => new BetterAuthAdapter(auth),
    },
  ],
  exports: [AUTH_INSTANCE, AUTH_PROVIDER, StepUpService],
})
export class AuthModule {}
