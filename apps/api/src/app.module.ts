import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AccountModule } from "./account/account.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { SessionGuard } from "./auth/session.guard.js";
import { ProblemFilter } from "./common/problem.filter.js";
import { RlsInterceptor } from "./common/rls.interceptor.js";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { EmailModule } from "./email/email.module.js";
import { HealthController } from "./health/health.controller.js";
import { SecurityModule } from "./security/security.module.js";

@Module({
  imports: [ConfigModule, DatabaseModule, EmailModule, SecurityModule, AuthModule, AccountModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
