# Phase 2 Payments to Credits

This phase formalizes the payment boundary for the MVP:

- `POST /checkout/session` creates a Stripe-style checkout session and attaches `userId`, `appId`, and `credits`
- `POST /webhooks/payment` verifies the incoming Stripe-style webhook signature before mutating state
- the webhook path is idempotent and grants credits exactly once
- `grantCredits(userId, appId, amount)` remains the balance mutation entry point and always writes a ledger entry with the grant

The implementation still uses a local mock Stripe gateway so the interface stays replaceable while preserving the final payment-to-credits flow.
