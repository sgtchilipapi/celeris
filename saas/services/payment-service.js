import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";

export class PaymentService {
  constructor({ store, ledgerService }) {
    this.store = store;
    this.ledgerService = ledgerService;
  }

  createCheckoutSession({ appId, userId, packageId, idempotencyKey }) {
    const cached = this.store.getIdempotent(`checkout:${appId}:${userId}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    const pkg = this.store.creditPackages.get(packageId);
    if (!pkg || pkg.appId !== appId) {
      throw new AppError(404, "credit package not found");
    }
    const payment = this.store.createPayment({
      paymentId: randomUUID(),
      userId,
      appId,
      packageId,
      providerSessionId: `checkout_${randomUUID()}`,
      amountCents: pkg.priceCents,
      credits: pkg.credits,
      status: "pending",
      idempotencyKey,
      createdAt: new Date().toISOString()
    });
    const result = {
      paymentId: payment.paymentId,
      checkoutSessionId: payment.providerSessionId,
      amountCents: payment.amountCents,
      credits: payment.credits
    };
    this.store.setIdempotent(`checkout:${appId}:${userId}`, idempotencyKey, result);
    return result;
  }

  applyPaymentWebhook({ providerSessionId, idempotencyKey }) {
    const payment = this.store.getPaymentByProviderSessionId(providerSessionId);
    if (!payment) {
      throw new AppError(404, "payment not found");
    }
    const cached = this.store.getIdempotent(`payment-webhook:${payment.paymentId}`, idempotencyKey);
    if (cached) {
      return cached;
    }
    if (payment.status === "paid") {
      const existing = {
        paymentId: payment.paymentId,
        userId: payment.userId,
        appId: payment.appId,
        grantedCredits: payment.credits,
        status: payment.status
      };
      this.store.setIdempotent(`payment-webhook:${payment.paymentId}`, idempotencyKey, existing);
      return existing;
    }
    payment.status = "paid";
    this.store.savePayment(payment);
    this.ledgerService.grantCredits({
      userId: payment.userId,
      appId: payment.appId,
      amount: payment.credits,
      idempotencyKey: `payment:${payment.paymentId}`,
      paymentId: payment.paymentId,
      metadata: { providerSessionId }
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
    const result = {
      paymentId: payment.paymentId,
      userId: payment.userId,
      appId: payment.appId,
      grantedCredits: payment.credits,
      status: payment.status
    };
    this.store.setIdempotent(`payment-webhook:${payment.paymentId}`, idempotencyKey, result);
    return result;
  }
}
