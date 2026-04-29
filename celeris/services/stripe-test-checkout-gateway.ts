import { AppError } from "./errors.js";
import type { CheckoutSessionMetadata, UUID } from "../types.js";

export class StripeTestCheckoutGateway {
  readonly secretKey: string;

  constructor({ secretKey }: { secretKey: string }) {
    this.secretKey = secretKey;
  }

  async createCheckoutSession({
    userId,
    appId,
    appName,
    credits,
    amountCents,
    successUrl,
    cancelUrl
  }: {
    userId: UUID;
    appId: UUID;
    appName?: string;
    credits: number;
    amountCents: number;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    if (!successUrl || !cancelUrl) {
      throw new AppError(422, "successUrl and cancelUrl are required for Stripe Checkout");
    }

    const metadata: CheckoutSessionMetadata = { userId, appId, credits };
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    form.set("payment_method_types[0]", "card");
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][unit_amount]", String(amountCents));
    form.set("line_items[0][price_data][product_data][name]", `${appName ?? "Celeris"} Credits`);
    form.set("line_items[0][price_data][product_data][description]", `${credits} credits`);
    form.set("metadata[userId]", userId);
    form.set("metadata[appId]", appId);
    form.set("metadata[credits]", String(credits));

    let response: Response;
    try {
      response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.secretKey}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        body: form
      });
    } catch (error) {
      throw new AppError(502, "failed to reach Stripe", { detail: (error as Error).message });
    }

    const payload = (await response.json()) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };

    if (!response.ok || !payload.id || !payload.url) {
      throw new AppError(502, payload.error?.message ?? "failed to create Stripe checkout session");
    }

    return {
      provider: "stripe",
      sessionId: payload.id,
      url: payload.url,
      amountCents,
      metadata,
      successUrl,
      cancelUrl
    };
  }
}
