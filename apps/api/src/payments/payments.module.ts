import { Module } from "@nestjs/common";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import {
  PAYMENT_ADAPTER,
  PAYMENTS_MODE,
  paymentAdapterFor,
  paymentsMode,
} from "./payment-adapter.js";
import {
  PaymentEventsController,
  PaymentsController,
  SimulatedProviderController,
} from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";

/** Add-on payments (feature 013). */
@Module({
  imports: [TenancyModule],
  controllers: [PaymentsController, PaymentEventsController, SimulatedProviderController],
  providers: [
    {
      provide: PAYMENT_ADAPTER,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => paymentAdapterFor(config),
    },
    {
      provide: PAYMENTS_MODE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => paymentsMode(config),
    },
    PaymentsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
