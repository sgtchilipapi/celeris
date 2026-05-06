# SDH-03 Sponsored Devnet Relayer

Read [SDH-context.md](./SDH-context.md) before implementing this work order.

## Objective

Replace the synthetic transaction-submission path with a real Solana devnet relayer that:

- resolves the app sponsor wallet
- signs as fee payer
- submits a real transaction to devnet RPC
- confirms the result
- returns the real Solana signature

This work order does not yet wire the full `say_hello` business flow.
It establishes the reusable sponsored-transaction runtime.

## Scope

In scope:

- devnet RPC configuration
- sponsor-wallet signer resolution
- real Solana submission and confirmation
- fee-payer balance preflight
- explorer URL generation
- relayer interface refactor away from fake base64 JSON transaction payloads

Out of scope:

- player-facing `say_hello` route wiring
- browser demo changes
- manual deploy/provision docs

## Dependencies

- `SDH-01`
- `SDH-02`

## Affected Files / Modules

- `celeris/types.ts`
- `celeris/api/index.ts`
- `celeris/services/relayer-service.ts`
- new Solana RPC and sponsor-wallet helper modules as needed
- relayer tests and transaction-verification tests

## Implementation Steps

1. Add devnet RPC runtime configuration.
   - Add a runtime config input for the Solana RPC origin.
   - Default it to a devnet RPC URL when not overridden.
   - Keep the cluster fixed to devnet in this slice.

2. Refactor the relayer input model.
   - Stop treating managed transactions as opaque base64 strings.
   - Introduce a backend-native prepared Solana transaction type that can carry:
     - the transaction object or compiled message
     - the app ID
     - the sponsor-wallet public key
     - optional debug metadata
   - Keep the relayer boundary reusable for later managed Solana actions.

3. Resolve the sponsor wallet at relay time.
   - Add a service or helper that loads the sponsor-wallet keypair for a given app.
   - Reject relay attempts for apps without a sponsor wallet.
   - Keep keypair material fully server-side.

4. Implement fee-payer signing.
   - The sponsor wallet must be set as fee payer.
   - The sponsor wallet must sign before submission.
   - Player wallets must not sign in this slice.

5. Add balance preflight.
   - Query the sponsor-wallet balance from devnet RPC before submission.
   - Estimate the transaction fee and require a fixed safety buffer of `100_000` lamports above the estimate.
   - Return an actionable `4xx` or `5xx` error when the sponsor wallet lacks sufficient SOL.

6. Add real submission and confirmation.
   - Submit the signed transaction to devnet RPC.
   - Confirm it with a real blockhash-based confirmation strategy.
   - Return the real Solana signature as `providerTxId`.
   - Surface confirmation failure as a relay failure.

7. Add Explorer URL generation.
   - Standardize Explorer URL generation as:
     - `https://explorer.solana.com/tx/<signature>?cluster=devnet`
   - Expose this as a shared utility used later by the player transaction feed.

## Acceptance Criteria

- The relayer can sign and submit a real devnet transaction with the app sponsor wallet as fee payer.
- The relayer rejects apps without a sponsor wallet.
- The relayer rejects sponsor wallets that do not have enough SOL.
- Successful submission returns a real Solana signature.
- Explorer URL generation is standardized and reusable.

## Unit Test Cases

- sponsor-wallet lookup rejects missing wallets
- balance preflight rejects insufficient SOL
- Explorer URL generation is correct for a given devnet signature
- relayer interface no longer accepts fake base64 JSON payloads for the devnet path

## Integration Test Cases

- a prepared transaction can be sponsor-signed and submitted through mocked Solana RPC
- a failed confirmation surfaces a relay failure
- a low-balance sponsor wallet is rejected before submission
- a successful submission returns a signature-shaped `providerTxId`
