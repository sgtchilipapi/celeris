# WO-03 Wallet Ledger And Payments

## Objective

Move all payment and credit ownership from `userId` to `WalletPrincipal`, and expose wallet-native checkout and Stripe webhook flows on the new player and service APIs.

This work order makes the credit system consistent with the updated MVP before any action execution refactor lands.

## Scope

In scope:

- wallet-address-based credit ledger
- wallet-address-based checkout creation
- wallet-address-based Stripe webhook processing
- wallet-address-based metrics internals

Out of scope:

- managed action execution
- player demo UI migration

## Dependencies

- `WO-01`
- `WO-02`

## Affected Files / Modules

- `celeris/types.ts`
- `celeris/db/memory-store.ts`
- `celeris/db/postgres-credit-balance-repository.ts`
- `celeris/db/migrations/001_foundations.sql`
- `celeris/services/credit-ledger-service.ts`
- `celeris/services/payment-service.ts`
- `celeris/services/mock-stripe-gateway.ts`
- `celeris/services/stripe-test-checkout-gateway.ts`
- `celeris/services/metrics-service.ts`
- `celeris/api/create-api.ts`
- `celeris/tests/ledger.test.ts`
- `celeris/tests/payments.test.ts`
- `celeris/tests/wallet-payments.test.ts` (new or replacement)

## Implementation Steps

1. Replace player ownership fields in all payment and ledger contracts.
   - `CreditBalance`
   - `CreditLedgerEntry`
   - `Payment`
   - `CheckoutSessionMetadata`
   - `PaymentWebhookResponse`
   - `UsageEvent` player context
   - metrics user/players output
   must use:
   - `walletAddress`
   - `chainId`

2. Rewrite `celeris/services/credit-ledger-service.ts`.
   - Change all public methods to accept `WalletPrincipal`.
   - Update idempotency scopes to key on `(appId, chainId, walletAddress)`.
   - Ensure balance mutation invariants remain unchanged:
     - no negative balance
     - no negative reserved
     - grant/reserve/capture/release remain idempotent

3. Rewrite balance storage and row locking.
   - Update `MemoryStore` balance keys to `(appId, chainId, walletAddress)`.
   - Update `PostgresCreditBalanceRepository.withLockedBalance` to read and write by wallet principal.

4. Rewrite `celeris/services/payment-service.ts`.
   - Replace `userId` inputs with `WalletPrincipal`.
   - Remove `POST /checkout/session` assumptions about caller-supplied player identifiers.
   - Store `walletAddress` and `chainId` in checkout metadata and payment records.
   - Grant credits to the wallet balance when the Stripe webhook is applied.

5. Rewrite payment routes in `celeris/api/create-api.ts`.
   - Replace `POST /checkout/session` with `POST /v1/apps/:appId/checkout-sessions`.
   - Replace `POST /webhooks/payment` with `POST /v1/webhooks/stripe`.
   - Derive wallet identity from the bearer token for checkout creation.
   - Do not accept `userId` in checkout requests.

6. Rewrite metrics internals to use wallet identity.
   - Update `MetricsService` output to expose wallet addresses for player-level rows.

7. Rewrite the ledger and payments test suites.
   - Replace `userId` expectations with wallet-principal expectations.

## Acceptance Criteria

- Every balance, ledger, and payment record is keyed by wallet address and chain.
- `POST /v1/apps/:appId/checkout-sessions` does not accept player identity from the request body.
- `POST /v1/webhooks/stripe` grants credits exactly once to the wallet balance.
- No payment metadata or response payload in this WO uses public `userId`.
- Ledger invariants and idempotency behavior remain intact after the ownership model changes.

## Unit Test Cases

- `CreditLedgerService.grantCredits` grants against `(appId, chainId, walletAddress)`.
- `reserveCredits`, `captureCredits`, and `releaseCredits` preserve existing invariants with wallet keys.
- `PaymentService.createCheckoutSession` stores wallet principal in payment metadata.
- `PaymentService.applyPaymentWebhook` grants to the wallet balance and remains idempotent by provider event.

## Integration Test Cases

- Authenticated `POST /v1/apps/:appId/checkout-sessions` returns a checkout session for the authenticated wallet.
- `POST /v1/webhooks/stripe` with a valid signed event grants credits to the correct wallet balance.
- Duplicate Stripe webhook events do not double-grant credits.
- Metrics queries used by developer routes can aggregate wallet-based purchases and credit usage.
