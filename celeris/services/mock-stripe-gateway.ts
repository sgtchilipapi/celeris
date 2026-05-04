import crypto, { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import type { CheckoutSessionMetadata, StripeCheckoutSessionCompletedEvent, WalletPrincipal, UUID } from "../types.js";

export class MockStripeGateway {
  readonly webhookSecret: string;

  constructor({ webhookSecret = "whsec_dev" }: { webhookSecret?: string } = {}) {
    this.webhookSecret = webhookSecret;
  }

  async createCheckoutSession({
    walletPrincipal,
    appId,
    credits,
    amountCents,
    successUrl,
    cancelUrl
  }: {
    walletPrincipal: WalletPrincipal;
    appId: UUID;
    credits: number;
    amountCents: number;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    const sessionId = `cs_test_${randomUUID()}`;
    const metadata: CheckoutSessionMetadata = {
      walletAddress: walletPrincipal.walletAddress,
      chainId: walletPrincipal.chainId,
      appId,
      credits
    };
    const checkoutUrl =
      successUrl && cancelUrl
        ? buildMockCheckoutUrl({
            sessionId,
            successUrl,
            cancelUrl,
            amountCents,
            metadata
          })
        : `https://checkout.stripe.local/session/${sessionId}`;

    return {
      provider: "stripe",
      sessionId,
      url: checkoutUrl,
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

function buildMockCheckoutUrl({
  sessionId,
  successUrl,
  cancelUrl,
  amountCents,
  metadata
}: {
  sessionId: string;
  successUrl: string;
  cancelUrl: string;
  amountCents: number;
  metadata: CheckoutSessionMetadata;
}) {
  const frontendOrigin = new URL(successUrl).origin;
  const checkoutUrl = new URL("/mock-checkout", frontendOrigin);
  checkoutUrl.searchParams.set("session_id", sessionId);
  checkoutUrl.searchParams.set("success_url", successUrl);
  checkoutUrl.searchParams.set("cancel_url", cancelUrl);
  checkoutUrl.searchParams.set("app_id", metadata.appId);
  checkoutUrl.searchParams.set("wallet_address", metadata.walletAddress ?? "");
  checkoutUrl.searchParams.set("chain_id", metadata.chainId ?? "");
  checkoutUrl.searchParams.set("credits", String(metadata.credits));
  checkoutUrl.searchParams.set("amount_cents", String(amountCents));
  return checkoutUrl.toString();
}
