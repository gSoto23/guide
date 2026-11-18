import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AccountModule } from "./account/account.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CalendarFeedsModule } from "./calendar-feeds/calendar-feeds.module.js";
import { SessionGuard } from "./auth/session.guard.js";
import { IdempotencyInterceptor } from "./common/idempotency.interceptor.js";
import { ProblemFilter } from "./common/problem.filter.js";
import { RlsInterceptor } from "./common/rls.interceptor.js";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { EmailModule } from "./email/email.module.js";
import { ExtractionsModule } from "./extractions/extractions.module.js";
import { GuidesModule } from "./guides/guides.module.js";
import { ImportRunsModule } from "./imports/import-runs.module.js";
import { HealthController } from "./health/health.controller.js";
import { IntegrationsModule } from "./integrations/integrations.module.js";
import { ListingContentModule } from "./listing-content/listing-content.module.js";
import { PmsModule } from "./pms/pms.module.js";
import { PropertiesModule } from "./properties/properties.module.js";
import { UploadsModule } from "./uploads/uploads.module.js";
import { SecurityModule } from "./security/security.module.js";
import { StaysModule } from "./stays/stays.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    EmailModule,
    SecurityModule,
    AuthModule,
    AccountModule,
    TenancyModule,
    IntegrationsModule,
    UploadsModule,
    PropertiesModule,
    GuidesModule,
    ListingContentModule,
    CalendarFeedsModule,
    StaysModule,
    ExtractionsModule,
    ImportRunsModule,
    PmsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    // Order matters: idempotency wraps the RLS transaction, so it stores only committed results.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
