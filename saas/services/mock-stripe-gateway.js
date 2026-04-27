import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";

export class MockStripeGateway {
  constructor({ webhookSecret = "whsec_dev" } = {}) {
    this.webhookSecret = webhookSecret;
  }

  createCheckoutSession({ userId, appId, credits, amountCents, successUrl, cancelUrl }) {
    const sessionId = `cs_test_${randomUUID()}`;
    return {
      provider: "stripe",
      sessionId,
      url: `https://checkout.stripe.local/session/${sessionId}`,
      amountCents,
      metadata: {
        userId,
        appId,
        credits
      },
      successUrl,
      cancelUrl
    };
  }

  verifyWebhookEvent({ payload, signature }) {
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

  signWebhookPayload(payload) {
    return crypto.createHmac("sha256", this.webhookSecret).update(JSON.stringify(payload)).digest("hex");
  }
}
