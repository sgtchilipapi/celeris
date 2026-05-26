# Sui Testnet Hello Demo Plan

This directory defines the canonical `SDH-SUI-*` planning stack for the Sui-backed Hello Celeris slice.

Sui testnet is the primary supported network for this plan.
The current Solana SDH documents remain legacy reference material and should not be treated as the forward-looking source of truth once `SDH-SUI-*` work begins.

## Summary

This slice keeps the same visible demo product:

- hosted Celeris sign-up and sign-in
- wallet address display
- credit balance display
- paid `say_hello`
- app-wide transaction feed with Explorer links

The primary pivots are:

- network target moves to Sui testnet
- hosted auth pivots from Privy to Celeris-owned Google OAuth plus zkLogin
- the browser SDK becomes the canonical `TransactionKind` builder
- Celeris no longer submits player transactions
- Celeris validates, reserves credits, sponsor-signs, and hands back the transaction bytes
- the browser silently adds the zkLogin user signature and submits directly to Sui RPC
- the browser reports outcome back to Celeris for credit reconciliation and feed recording

## Product Decisions

- Player policy is `sui:testnet`.
- `authProvider` is `zklogin`.
- Google is the only supported OpenID provider in this slice.
- `mock-game-frontend/` remains the only canonical player demo surface.
- Credits remain keyed by app, wallet address, and chain ID.
- The wallet address is the zkLogin-derived Sui address resolved during hosted auth.
- One sponsor wallet is supported per app.
- One registered Sui package plus app-state object is supported per app.
- The browser must not show a separate wallet-connect or wallet-sign popup during the canonical flow.

## Work Order Sequence

Shared implementation context for all work orders:

- [SDH-SUI-context](./SDH-SUI-context.md)

| WO | Title | Primary Output | Depends On |
| --- | --- | --- | --- |
| [SDH-SUI-01](./SDH-SUI-01-move-hello-package-and-local-toolchain.md) | Move hello package and local toolchain | repo-local Move package, Sui tooling, shared builder helpers | none |
| [SDH-SUI-02](./SDH-SUI-02-zklogin-hosted-auth-foundation.md) | zkLogin hosted auth foundation | Google OAuth plus zkLogin hosted auth, salts, proof flow, player session contract | SDH-SUI-01 |
| [SDH-SUI-03](./SDH-SUI-03-sui-registration-and-sponsor-wallet-foundations.md) | Sui registration and sponsor wallet foundations | backend models and developer APIs for package registration and sponsor wallets | SDH-SUI-01 |
| [SDH-SUI-04](./SDH-SUI-04-sponsored-transaction-preparation-and-reconciliation.md) | Sponsored transaction preparation and reconciliation | sponsor-signing path, completion route, reconciliation, app-wide feed | SDH-SUI-01, SDH-SUI-02, SDH-SUI-03 |
| [SDH-SUI-05](./SDH-SUI-05-browser-sdk-and-shared-sui-builder.md) | Browser SDK and shared Sui builder | canonical `TransactionKind` builder and silent zkLogin submission flow | SDH-SUI-01, SDH-SUI-02, SDH-SUI-04 |
| [SDH-SUI-06](./SDH-SUI-06-simplified-browser-demo.md) | Simplified browser demo | hard-cut `mock-game-frontend` to the Sui Hello Celeris flow | SDH-SUI-02, SDH-SUI-04, SDH-SUI-05 |
| [SDH-SUI-07](./SDH-SUI-07-manual-setup-tooling-regression-solana-demotion.md) | Manual setup, tooling, regression, Solana demotion | setup docs, helper scripts, regression surface, Solana demotion | SDH-SUI-01, SDH-SUI-02, SDH-SUI-03, SDH-SUI-04, SDH-SUI-05, SDH-SUI-06 |
| [SDH-SUI-08](./SDH-SUI-08-real-google-auth-and-real-zklogin-prover.md) | Real Google auth and real zkLogin prover | hosted Google account selection, Google JWKS verification, self-hosted prover integration | SDH-SUI-02, SDH-SUI-05, SDH-SUI-06, SDH-SUI-07 |

## Canonical Flow

1. The browser SDK starts hosted login and creates zkLogin ephemeral session state.
2. The user signs in with Google on the Celeris auth origin.
3. Celeris verifies the login, resolves the zkLogin address, obtains proof inputs, and issues a Celeris player session.
4. The browser loads app catalog, balance, and transaction feed through the player API.
5. The browser SDK builds the canonical `say_hello` `TransactionKind`.
6. Celeris validates the request, reserves credits, adds sponsor gas data, signs as sponsor, and returns transaction bytes.
7. The browser silently adds the zkLogin signature and submits to Sui testnet RPC.
8. The browser calls the completion route with success or failure.
9. Celeris verifies the result, captures or releases credits, and records the transaction in the app-wide feed.

## Notes

- The work orders intentionally preserve the repo's current TypeScript-first and memory-store-backed constraints unless a work order explicitly broadens scope.
- The plan does not introduce generic multi-chain abstractions beyond what is needed to make Sui primary and leave Solana as a legacy path.
