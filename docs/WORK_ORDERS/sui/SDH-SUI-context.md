# SDH-SUI Context

Read this document before implementing any `SDH-SUI-*` work order.

It captures the shared context, invariants, repo reality, and sequencing assumptions for the Sui testnet Hello Celeris slice.

## Purpose

The `SDH-SUI-*` work orders are intentionally bite-sized.

This document prevents each work order from having to restate the same background:

- why the slice exists
- what is already true in the repo
- what the target product behavior is
- what assumptions are fixed across all SUI work
- what must not be changed accidentally while implementing one slice

## Canonical Scope

This slice adds a real Sui-backed demo path to Celeris with these product rules:

- chain target is Sui testnet
- player policy is `sui:testnet`
- hosted auth remains Celeris-owned and browser-SDK-driven
- auth provider changes to zkLogin backed by Google OAuth
- the only player demo surface remains `mock-game-frontend/`
- the player demo is simplified to:
  - wallet address
  - credits
  - username input
  - `Purchase Credits`
  - `Say Hello Celeris`
  - app-wide transaction panel
- the paid on-chain action is `say_hello`
- the player transaction panel shows all Celeris-managed app transactions, not only the current player's and not a chain-wide scan

## Transaction Responsibility Split

This boundary is fixed across all `SDH-SUI-*` work orders:

- frontend initiates
- browser SDK builds the canonical `TransactionKind`
- Celeris authenticates and validates
- Celeris reserves credits
- Celeris chooses sponsor gas data and signs as sponsor
- Celeris hands back transaction bytes and sponsor signature
- the browser silently adds the zkLogin user signature and submits to Sui
- the browser reports submitted or failed outcome back to Celeris
- Celeris verifies and reconciles
- the Sui Move package mutates state

The supported model is not:

- browser-defined arbitrary app transactions that Celeris accepts without canonical validation
- developer-owned external sponsor signing outside Celeris
- wallet popup signing as the primary demo contract
- Celeris submitting player transactions on the happy path

## Auth Model

Hosted auth is Celeris-owned.

The canonical browser login model is:

- the browser SDK creates zkLogin ephemeral session state
- the hosted auth page performs Google OAuth on the Celeris auth origin
- Celeris verifies the Google identity token and nonce
- Celeris persists or retrieves a stable user salt
- Celeris derives the zkLogin Sui address
- Celeris obtains zkLogin proof inputs
- Celeris issues a normal player auth code and player session

Assumptions fixed for this slice:

- Google is the only supported OpenID provider
- the browser stores ephemeral zkLogin secret material only in session-scoped storage
- the player session remains the source of truth for wallet identity on player API routes

## Sponsor Wallet Model

Every app gets one sponsor wallet for this slice.

The sponsor wallet is:

- Celeris-controlled
- funded by the developer with testnet SUI
- scoped to one app
- used as gas owner for managed app transactions

Assumptions fixed for this MVP slice:

- one sponsor wallet per app
- no wallet rotation flow
- no withdrawal flow
- no multi-wallet routing
- no production-grade secret-management redesign in this phase

## On-Chain Model

The Sui Move package is in-repo.

The canonical entry functions are:

- `initialize_app`
- `say_hello`

The canonical `say_hello` behavior is:

- use the transaction sender as the player wallet
- accept `username`
- render `"<username> says Hello Celeris!"` canonically
- append one greeting entry to app state

Storage assumptions:

- one shared app state object per app
- one authority capability object per app
- fixed capacity of 100 greeting entries
- no resizing, pagination, rollover, or archival in this slice

## Backend Model Additions

The slice introduces or pivots these first-class concepts:

- Sui-shaped `RegisteredProgram`
- Sui sponsor wallet model
- zkLogin session material and salt management
- sponsored-transaction reservation and reconciliation state
- generalized transaction summary and metadata that supports Sui `say_hello`
- app-wide player transaction feed

These are backend-owned concepts.

Do not implement them as:

- frontend-only config
- script-only conventions
- dashboard-only local state

## API Direction

Developer API additions or pivots:

- Sui package registration routes
- sponsor-wallet provisioning and read routes

Player API additions or pivots:

- `say_hello` sponsorship preparation through the existing execute route
- `say_hello` completion route
- app-wide player transaction feed

Keep existing auth rules intact:

- developer routes require developer bearer auth
- player routes derive identity from the Celeris player session
- no player-facing route accepts wallet identity from the caller as source of truth

## Current Repo Reality

At the start of the `SDH-SUI` series, the repo already has:

- hosted Celeris auth and browser SDK flow
- developer and player `v1` APIs
- wallet-based credits and mock Stripe checkout
- a standalone `mock-game-frontend`
- a managed-action pipeline
- a Solana SDH planning stack and partial Solana implementation

But the repo does not yet have the actual SUI target behavior.

Important gaps the `SDH-SUI` work orders close:

- no in-repo Sui Move package
- no zkLogin auth model
- no backend model for Sui package registration
- no backend model for Sui sponsor wallets
- no sponsor-sign-and-hand-back flow
- no Sui transaction reconciliation path
- current managed-action and relayer surfaces remain Solana-shaped
- current hosted auth stack is Privy-specific

## Existing Code Constraints

While implementing `SDH-SUI` work, expect these existing repo constraints:

- the runtime is TypeScript-first and currently memory-store-backed
- `create-api.ts` is the central route surface
- `api/index.ts` wires service construction and runtime config
- the browser demo already proxies `/api/*` and serves `/config.json`
- the existing player session model already carries `walletAddress` and `chainId`
- the worktree may already be dirty with doc changes related to the SUI plan

Do not assume:

- a real persistence layer exists for new SUI domain objects
- a real indexer exists for transaction feeds
- a generic chain abstraction is already in place
- a Solana-first relayer shape is the right end state for SUI

## Execution Order

Implement the `SDH-SUI` work in this order:

1. `SDH-SUI-01-move-hello-package-and-local-toolchain.md`
2. `SDH-SUI-02-zklogin-hosted-auth-foundation.md`
3. `SDH-SUI-03-sui-registration-and-sponsor-wallet-foundations.md`
4. `SDH-SUI-04-sponsored-transaction-preparation-and-reconciliation.md`
5. `SDH-SUI-05-browser-sdk-and-shared-sui-builder.md`
6. `SDH-SUI-06-simplified-browser-demo.md`
7. `SDH-SUI-07-manual-setup-tooling-regression-solana-demotion.md`

Do not skip ahead unless the later work order explicitly depends only on completed pieces.

## Global Invariants

All `SDH-SUI` work orders must preserve these invariants:

1. Player identity always comes from the authenticated Celeris player session.
2. Credits remain keyed by app, wallet address, and chain ID.
3. The wallet address for this slice is the zkLogin-derived Sui address.
4. The browser SDK is the canonical builder for player `say_hello` `TransactionKind` in the browser path.
5. Celeris must validate the caller-provided transaction against the canonical backend-built shape before sponsor-signing.
6. The sponsor wallet is always the gas owner for managed app transactions.
7. The browser, not Celeris, submits the happy-path player transaction to Sui.
8. The runtime stores real Sui digests and Explorer URLs for successful or submitted `say_hello` transactions.
9. The player transaction feed is sourced from Celeris-stored managed transactions, not a chain-wide explorer scrape.
10. The only canonical player demo surface remains `mock-game-frontend/`.
11. The demo purchase path remains the existing mock Stripe flow unless a work order explicitly says otherwise.
12. No `SDH-SUI` work order should reintroduce Privy as the canonical auth dependency for this slice.

## Non-Goals

These are intentionally out of scope unless a work order explicitly says otherwise:

- local validator orchestration
- one-command full-demo orchestration
- external wallet-connect UX in the canonical browser demo
- sponsor-wallet rotation
- sponsor-wallet withdrawal UX
- production key-management redesign
- chain-wide transaction indexing
- generalized multi-program-per-app support
- broad multi-chain refactoring beyond what is required to make Sui primary
- OAuth provider rotation or multi-provider support

## Manual Flow Target

By the end of the `SDH-SUI` series, the canonical manual flow should be:

1. start the zkLogin prover services
2. start the API with zkLogin auth config
3. create a Celeris app with `authProvider=zklogin` and `allowedChainId=sui:testnet`
4. provision the sponsor wallet
5. fund the sponsor wallet with testnet SUI
6. publish the in-repo Move package to Sui testnet
7. initialize the app state on chain
8. register the deployed package and object IDs
9. configure the paid `say_hello` action
10. start API and standalone frontend
11. sign in through hosted auth
12. buy credits
13. execute `say_hello`
14. inspect the transaction in Sui Explorer

## Guidance For Implementation Agents

When implementing an `SDH-SUI-*` work order:

- read this file first
- read the specific `SDH-SUI-*` work order second
- limit changes to the work order scope unless a missing prerequisite must be fixed
- prefer extending existing services and route patterns over inventing parallel architecture
- preserve the current hosted-auth and SDK split
- keep new docs and config aligned with Sui testnet, not Solana devnet or localnet
- update tests with each work order rather than deferring all verification to the end

If a work order appears to conflict with this context document, treat this document and the SUI work order index in this directory as the source of truth and update the conflicting work order only if the conflict is clearly accidental.
