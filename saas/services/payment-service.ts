import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type {
  CheckoutSessionResponse,
  CreateCheckoutSessionRequest,
  MemoryStore,
  PaymentWebhookResponse,
  StripeCheckoutSessionCompletedEvent
} from "../types.js";
import { CreditLedgerService } from "./credit-ledger-service.js";
import { MockStripeGateway } from "./mock-stripe-gateway.js";

export class PaymentService {
  readonly store: MemoryStore;
  readonly ledgerService: CreditLedgerService;
  readonly stripeGateway: MockStripeGateway;

  constructor({ store, ledgerService, stripeGateway }: { store: MemoryStore; ledgerService: CreditLedgerService; stripeGateway: MockStripeGateway }) {
    this.store = store;
    this.ledgerService = ledgerService;
    this.stripeGateway = stripeGateway;
  }

  createCheckoutSession({ appId, userId, packageId, successUrl, cancelUrl, idempotencyKey }: CreateCheckoutSessionRequest): CheckoutSessionResponse {
    const cached = this.store.getIdempotent<CheckoutSessionResponse>(`checkout:${appId}:${userId}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    const pkg = this.store.creditPackages.get(packageId);
    if (!pkg || pkg.appId !== appId) {
      throw new AppError(404, "credit package not found");
    }
    const checkoutSession = this.stripeGateway.createCheckoutSession({
      userId,
      appId,
      credits: pkg.credits,
      amountCents: pkg.priceCents,
      successUrl,
      cancelUrl
    });
    const payment = this.store.createPayment({
      paymentId: randomUUID(),
      userId,
      appId,
      packageId,
      provider: checkoutSession.provider,
      providerSessionId: checkoutSession.sessionId,
      amountCents: pkg.priceCents,
      credits: pkg.credits,
      status: "pending",
      idempotencyKey,
      metadata: checkoutSession.metadata,
      createdAt: new Date().toISOString()
    });
    const result: CheckoutSessionResponse = {
      paymentId: payment.paymentId,
      checkoutSessionId: payment.providerSessionId,
      checkoutUrl: checkoutSession.url,
      amountCents: payment.amountCents,
      credits: payment.credits,
      provider: payment.provider,
      metadata: checkoutSession.metadata
    };
    this.store.setIdempotent(`checkout:${appId}:${userId}`, idempotencyKey, result);
    return result;
  }

  applyPaymentWebhook({
    payload,
    stripeSignature,
    idempotencyKey
  }: {
    payload: StripeCheckoutSessionCompletedEvent;
    stripeSignature?: string;
    idempotencyKey: string;
  }): PaymentWebhookResponse | { received: true; ignored: true; eventId: string } {
    const event = this.stripeGateway.verifyWebhookEvent({
      payload,
      signature: stripeSignature
    });
    if (event.type !== "checkout.session.completed") {
      return {
        received: true,
        ignored: true,
        eventId: event.id
      };
    }

    const session = event.data?.object;
    if (!session?.id || !session.metadata?.userId || !session.metadata?.appId || !session.metadata?.credits) {
      throw new AppError(422, "stripe event missing required checkout metadata");
    }

    let payment = this.store.getPaymentByProviderSessionId(session.id);
    if (!payment) {
      const packageMatch = [...this.store.creditPackages.values()].find(
        (pkg) =>
          pkg.appId === session.metadata.appId &&
          pkg.credits === Number(session.metadata.credits) &&
          pkg.priceCents === Number(session.amount_total)
      );
      if (!packageMatch) {
        throw new AppError(404, "credit package not found for webhook event");
      }
      payment = this.store.createPayment({
        paymentId: randomUUID(),
        userId: session.metadata.userId,
        appId: session.metadata.appId,
        packageId: packageMatch.packageId,
        provider: "stripe",
        providerSessionId: session.id,
        amountCents: Number(session.amount_total),
        credits: Number(session.metadata.credits),
        status: "pending",
        idempotencyKey,
        metadata: session.metadata,
        createdAt: new Date().toISOString()
      });
    }
    const cached = this.store.getIdempotent<PaymentWebhookResponse>(`payment-webhook:${payment.paymentId}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    if (this.store.getPaymentByProviderEventId(event.id)) {
      const duplicate: PaymentWebhookResponse = {
        paymentId: payment.paymentId,
        userId: payment.userId,
        appId: payment.appId,
        grantedCredits: payment.credits,
        status: payment.status,
        providerEventId: event.id
      };
      this.store.setIdempotent(`payment-webhook:${payment.paymentId}`, idempotencyKey, duplicate);
      return duplicate;
    }
    if (payment.status === "paid") {
      const existing: PaymentWebhookResponse = {
        paymentId: payment.paymentId,
        userId: payment.userId,
        appId: payment.appId,
        grantedCredits: payment.credits,
        status: payment.status,
        providerEventId: event.id
      };
      this.store.setIdempotent(`payment-webhook:${payment.paymentId}`, idempotencyKey, existing);
      return existing;
    }
    payment.providerEventId = event.id;
    payment.status = "paid";
    this.store.savePayment(payment);
    this.ledgerService.grantCredits({
      userId: payment.userId,
      appId: payment.appId,
      amount: payment.credits,
      idempotencyKey: `payment:${payment.paymentId}`,
      paymentId: payment.paymentId,
      metadata: { providerSessionId: payment.providerSessionId, providerEventId: event.id }
    });
    this.store.recordUsageEvent({
      eventId: randomUUID(),
      appId: payment.appId,
      userId: payment.userId,
      eventType: "credits_purchased",
      value: payment.credits,
      metadata: { paymentId: payment.paymentId },
      createdAt: new Date().toISOString()
    });
    const result: PaymentWebhookResponse = {
      paymentId: payment.paymentId,
      userId: payment.userId,
      appId: payment.appId,
      grantedCredits: payment.credits,
      status: payment.status,
      providerEventId: event.id
    };
    this.store.setIdempotent(`payment-webhook:${payment.paymentId}`, idempotencyKey, result);
    return result;
  }
}
