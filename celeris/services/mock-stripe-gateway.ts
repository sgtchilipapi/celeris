import crypto, { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type { CheckoutSessionMetadata, StripeCheckoutSessionCompletedEvent, UUID } from "../types.js";

export class MockStripeGateway {
  readonly webhookSecret: string;

  constructor({ webhookSecret = "whsec_dev" }: { webhookSecret?: string } = {}) {
    this.webhookSecret = webhookSecret;
  }

  createCheckoutSession({
    userId,
    appId,
    credits,
    amountCents,
    successUrl,
    cancelUrl
  }: {
    userId: UUID;
    appId: UUID;
    credits: number;
    amountCents: number;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    const sessionId = `cs_test_${randomUUID()}`;
    const metadata: CheckoutSessionMetadata = { userId, appId, credits };
    return {
      provider: "stripe",
      sessionId,
      url: `https://checkout.stripe.local/session/${sessionId}`,
      amountCents,
      metadata,
      successUrl,
      cancelUrl
    };
  }

  verifyWebhookEvent({ payload, signature }: { payload: StripeCheckoutSessionCompletedEvent; signature?: string }): StripeCheckoutSessionCompletedEvent {
    if (!signature) {
      throw new AppError(400, "missing stripe signature");
    }
    const serialized = JSON.stringify(payload);
    const expected = crypto.createHmac("sha256", this.webhookSecret).update(serialized).digest("hex");
    if (signature !== expected) {
      throw new AppError(400, "invalid stripe signature");
    }
    return payload;
  }

  signWebhookPayload(payload: StripeCheckoutSessionCompletedEvent): string {
    return crypto.createHmac("sha256", this.webhookSecret).update(JSON.stringify(payload)).digest("hex");
  }
}
