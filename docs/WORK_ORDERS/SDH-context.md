# SDH Context

Read this document before implementing any `SDH-*` work order.

It captures the shared context, invariants, repo reality, and sequencing assumptions for the Solana devnet Hello Celeris slice.

## Purpose

The `SDH-*` work orders are intentionally bite-sized.

This document prevents each work order from having to restate the same background:

- why the slice exists
- what is already true in the repo
- what the target product behavior is
- what assumptions are fixed across all SDH work
- what must not be changed accidentally while implementing one slice

## Canonical Scope

This slice adds a real Solana-backed demo path to Celeris with these product rules:

- chain target is Solana devnet
- player policy remains `solana:103`
- hosted auth remains Celeris-owned auth wrapping Privy
- the only player demo surface remains `mock-game-frontend/`
- the player demo is simplified to:
  - wallet address
  - credits
  - username input
  - `Purchase Credits`
  - `Say Hello Celeris`
  - app-wide transaction panel
- the paid on-chain action is `say_hello`
- the player transaction panel shows all Celeris-submitted app transactions, not only the current player's and not a chain-wide scan

## Transaction Responsibility Split

This boundary is fixed across all SDH work orders:

- frontend initiates
- Celeris authenticates and validates
- Celeris builds the transaction
- the per-app sponsor wallet pays SOL and signs as fee payer
- Celeris relays and confirms
- the Solana program mutates state

The supported model is not:

- browser-signed player transactions
- developer-owned external fee payer signing outside Celeris
- dual sponsor/signer models

## Sponsor Wallet Model

Every app gets one sponsor wallet for this slice.

The sponsor wallet is:

- Celeris-controlled
- funded by the developer with devnet SOL
- scoped to one app
- used as fee payer for managed app transactions

Assumptions fixed for this MVP slice:

- one sponsor wallet per app
- no wallet rotation flow
- no withdrawal flow
- no multi-wallet routing
- no production-grade secret-management redesign in this phase

## On-Chain Model

The Solana program is in-repo and Anchor-based.

The canonical instructions are:

- `initialize_app`
- `say_hello`

The canonical `say_hello` behavior is:

- accept player wallet as data, not as signer
- accept `username`
- render `"<username> says Hello Celeris!"` canonically
- append one greeting entry to app state

Storage assumptions:

- one app state PDA per app
- deterministic PDA derived from hashed `appId`
- fixed capacity of 100 greeting entries
- no resizing, pagination, rollover, or archival in this slice

## Backend Model Additions

The slice introduces these first-class concepts:

- `RegisteredProgram`
- `SponsorWallet`
- generalized transaction summary/metadata that supports `say_hello`
- app-wide player transaction feed

These are backend-owned concepts.

Do not implement them as:

- frontend-only config
- script-only conventions
- dashboard-only local state

## API Direction

Developer API additions:

- program registration routes
- sponsor-wallet provisioning and read routes

Player API additions:

- `say_hello` execution through the existing action execute route
- app-wide player transaction feed

Keep existing auth rules intact:

- developer routes require developer bearer auth
- player routes derive identity from the Celeris player session
- no player-facing route accepts wallet identity from the caller as source of truth

## Current Repo Reality

At the start of the SDH series, the repo already has:

- hosted Celeris auth and browser SDK flow
- developer and player `v1` APIs
- wallet-based credits and mock Stripe checkout
- a standalone `mock-game-frontend`
- a managed-action pipeline

But the repo does not yet have the actual SDH target behavior.

Important gaps the SDH work orders close:

- no in-repo Anchor Solana program
- no backend model for registered programs
- no backend model for sponsor wallets
- no real Solana devnet relay path
- current relayer path is synthetic
- current managed transaction builder returns placeholder payloads
- current player demo is still the RPG-style flow
- current standalone frontend config still carries legacy RPG/demo assumptions

## Existing Code Constraints

While implementing SDH work, expect these existing repo constraints:

- the runtime is TypeScript-first and currently memory-store-backed
- `create-api.ts` is the central route surface
- `api/index.ts` wires service construction and runtime config
- the relayer path currently abstracts submission through `RelayerService`
- the browser demo already proxies `/api/*` and serves `/config.json`
- the worktree may already be dirty with doc changes related to the SDH plan

Do not assume:

- a real persistence layer exists for new Solana domain objects
- a real indexer exists for transaction feeds
- a local validator flow is desired

## Execution Order

Implement the SDH work in this order:

1. `SDH-01-anchor-hello-program.md`
2. `SDH-02-program-registration-and-sponsor-wallet-foundations.md`
3. `SDH-03-sponsored-devnet-relayer.md`
4. `SDH-04-say-hello-managed-action-and-player-feed.md`
5. `SDH-05-simplified-browser-demo.md`
6. `SDH-06-manual-setup-and-regression.md`

Do not skip ahead unless the later work order explicitly depends only on completed pieces.

## Global Invariants

All SDH work orders must preserve these invariants:

1. Player identity always comes from the authenticated Celeris player session.
2. The frontend never signs player transactions directly for this slice.
3. The sponsor wallet is always the fee payer for managed app transactions.
4. The runtime stores real Solana signatures and Explorer URLs for successful or submitted `say_hello` transactions.
5. The player transaction feed is sourced from Celeris-stored managed transactions, not a chain-wide explorer scrape.
6. The only canonical player demo surface remains `mock-game-frontend/`.
7. The demo purchase path remains the existing mock Stripe flow unless a work order explicitly says otherwise.
8. No SDH work order should reintroduce contradictory localnet assumptions.

## Non-Goals

These are intentionally out of scope unless a work order explicitly says otherwise:

- local validator orchestration
- one-command full-demo orchestration
- player-wallet signing in the browser
- sponsor-wallet rotation
- sponsor-wallet withdrawal UX
- production key-management redesign
- chain-wide transaction indexing
- generalized multi-program-per-app support

## Manual Flow Target

By the end of the SDH series, the canonical manual flow should be:

1. deploy the Anchor program to devnet
2. create a Celeris app
3. provision the sponsor wallet
4. fund the sponsor wallet with devnet SOL
5. register the deployed program
6. configure the paid `say_hello` action
7. start API and standalone frontend
8. sign in through hosted auth
9. buy credits
10. execute `say_hello`
11. inspect the transaction in Solana Explorer

## Guidance For Implementation Agents

When implementing an `SDH-*` work order:

- read this file first
- read the specific `SDH-*` work order second
- limit changes to the work order scope unless a missing prerequisite must be fixed
- prefer extending existing services and route patterns over inventing parallel architecture
- preserve the current hosted-auth and SDK split
- keep new docs and config aligned with devnet, not localnet
- update tests with each work order rather than deferring all verification to the end

If a work order appears to conflict with this context document, treat this document plus `docs/solana-devnet-hello-demo-plan.md` as the source of truth and update the work order only if the conflict is clearly accidental.
