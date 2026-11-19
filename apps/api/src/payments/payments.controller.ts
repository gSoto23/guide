import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  refundSchema,
  type PaymentRefundResult,
  type PayoutOnboarding,
  type Payouts,
  type RefundBody,
} from "@guidesk/contracts";
import { SimulatedPaymentAdapter, simulatedFee } from "@guidesk/integrations";
import { randomUUID } from "node:crypto";
import { Inject } from "@nestjs/common";
import type { PaymentPort } from "@guidesk/integrations";
import { Public } from "../auth/public.decorator.js";
import { RequireStepUp } from "../auth/step-up.guard.js";
import { assertUuid } from "../common/ids.js";
import { ApiProblem } from "../common/problem.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { RequestDb } from "../database/request-db.js";
import { callerOf } from "../properties/properties.controller.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { PAYMENT_ADAPTER } from "./payment-adapter.js";
import { PaymentsService } from "./payments.service.js";

const languageOf = (value: unknown): "es" | "en" => (value === "en" ? "en" : "es");

/** /api/v1/workspaces/{ws}/payouts and payment-orders (feature 013 contracts). */
@Controller("v1/workspaces/:workspaceId")
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
  ) {}

  @Get("payouts")
  @WorkspaceAction({ capability: "conversations.handle" })
  payouts(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
  ): Promise<Payouts> {
    return this.payments.payouts(this.requestDb.current(), workspaceId, callerOf(request).role);
  }

  @Post("payouts/onboarding")
  @HttpCode(200)
  @WorkspaceAction({ capability: "workspace.billing" })
  onboarding(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Query("lang") lang: unknown,
  ): Promise<PayoutOnboarding> {
    return this.payments.startOnboarding(callerOf(request).userId, workspaceId, languageOf(lang));
  }

  @Post("payment-orders/:orderId/refunds")
  @HttpCode(201)
  @WorkspaceAction({ capability: "payments.refund" })
  @RequireStepUp()
  async refund(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("orderId") orderId: string,
    @Body(new ZodValidationPipe(refundSchema)) body: RefundBody,
  ): Promise<PaymentRefundResult> {
    assertUuid(orderId);
    const caller = callerOf(request);
    try {
      return await this.payments.refund(caller.userId, workspaceId, orderId, body.amountMinor);
    } catch (error) {
      if (error instanceof ApiProblem && error.code === "not_found") {
        throw await this.crossTenant.notFound(caller.userId, workspaceId, "payment_order", orderId);
      }
      throw error;
    }
  }
}

/**
 * Provider events (feature 013 research R4): public and server to server, verified by signature.
 * No cookies are read, so the portal's origin check does not apply.
 */
@Public()
@Controller("v1/payments/events")
export class PaymentEventsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":provider")
  @HttpCode(200)
  handle(
    @Param("provider") provider: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ status: "handled" | "duplicate" }> {
    return this.payments.handleEvent(provider, body, headers);
  }
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><p><strong>Simulated payment provider</strong> (development only; no real money).</p>${body}</main></body></html>`;
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * The simulated provider's hosted pages (feature 013 research R1), only in `simulated` mode. Links
 * carry the action because HTML form posts are never parsed (T103). An action signs an event, hands
 * it to the same handler as the provider route, and returns to the signed return URL.
 */
@Public()
@Controller("v1/simulated-provider")
export class SimulatedProviderController {
  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_ADAPTER) private readonly adapter: PaymentPort | null,
  ) {}

  private simulated(): SimulatedPaymentAdapter {
    if (!(this.adapter instanceof SimulatedPaymentAdapter)) throw new ApiProblem(404, "not_found");
    return this.adapter;
  }

  private send(reply: FastifyReply, html: string) {
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .header("content-security-policy", "default-src 'none'; form-action 'none'")
      .send(html);
  }

  @Get("checkout")
  async checkout(
    @Query("token") token: unknown,
    @Query("action") action: unknown,
    @Res() reply: FastifyReply,
  ) {
    const adapter = this.simulated();
    const data = typeof token === "string" ? adapter.readToken(token) : null;
    if (!data || data.kind !== "checkout") throw new ApiProblem(404, "not_found");
    const expired = new Date(data.expiresAt).getTime() <= Date.now();
    if (action === "pay" || action === "decline") {
      if (expired) throw new ApiProblem(410, "expired", "This checkout expired.");
      const event =
        action === "pay"
          ? {
              type: "payment.succeeded" as const,
              eventId: randomUUID(),
              orderId: data.orderId,
              providerReference: data.providerReference,
              amountMinor: data.amountMinor,
              currency: data.currency,
              providerFeeMinor: simulatedFee(data.amountMinor, data.currency),
            }
          : {
              type: "payment.failed" as const,
              eventId: randomUUID(),
              orderId: data.orderId,
              providerReference: data.providerReference,
            };
      const signed = adapter.signEvent(event);
      await this.payments.handleEvent(
        "simulated",
        JSON.parse(JSON.stringify(signed.body)),
        signed.headers,
      );
      return reply.redirect(data.returnUrl, 303);
    }
    const amount = `${(data.amountMinor / 100).toFixed(2)} ${data.currency}`;
    const base = `?token=${encodeURIComponent(token as string)}`;
    return this.send(
      reply,
      page(
        "Simulated checkout",
        expired
          ? "<p>This checkout expired.</p>"
          : `<h1>Pay ${escape(amount)}</h1><p>${escape(data.description)}</p><p><a href="${base}&amp;action=pay">Pay ${escape(amount)}</a></p><p><a href="${base}&amp;action=decline">Decline the payment</a></p>`,
      ),
    );
  }

  @Get("onboarding")
  async onboarding(
    @Query("token") token: unknown,
    @Query("action") action: unknown,
    @Res() reply: FastifyReply,
  ) {
    const adapter = this.simulated();
    const data = typeof token === "string" ? adapter.readToken(token) : null;
    if (!data || data.kind !== "onboarding") throw new ApiProblem(404, "not_found");
    if (action === "approve" || action === "reject") {
      const signed = adapter.signEvent({
        type: action === "approve" ? "merchant.activated" : "merchant.rejected",
        eventId: randomUUID(),
        workspaceId: data.workspaceId,
        providerAccountId: data.providerAccountId,
      });
      await this.payments.handleEvent(
        "simulated",
        JSON.parse(JSON.stringify(signed.body)),
        signed.headers,
      );
      return reply.redirect(data.returnUrl, 303);
    }
    const base = `?token=${encodeURIComponent(token as string)}`;
    return this.send(
      reply,
      page(
        "Simulated payouts onboarding",
        `<h1>Set up payouts</h1><p>Identity and bank checks happen here at the provider.</p><p><a href="${base}&amp;action=approve">Approve the account</a></p><p><a href="${base}&amp;action=reject">Reject the account</a></p>`,
      ),
    );
  }
}
