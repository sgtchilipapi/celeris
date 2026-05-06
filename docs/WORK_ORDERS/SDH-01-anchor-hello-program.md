# SDH-01 Anchor Hello Program

Read [SDH-context.md](./SDH-context.md) before implementing this work order.

## Objective

Add the in-repo Solana program and shared client helpers that define the canonical devnet `say_hello` contract for the rest of the slice.

This work order establishes:

- the Anchor workspace
- the app state account layout
- the sponsor-authority model
- the deterministic PDA derivation rule
- the canonical `say_hello` instruction contract

Later work orders must build on these rules rather than inventing parallel Solana wiring.

## Scope

In scope:

- Anchor workspace and package wiring
- `initialize_app` and `say_hello` instructions
- deterministic PDA derivation based on Celeris `appId`
- fixed-capacity greeting storage
- TypeScript helper utilities used later by the backend

Out of scope:

- developer API endpoints
- sponsor-wallet provisioning
- Solana RPC submission
- browser demo changes

## Dependencies

- none

## Affected Files / Modules

- `package.json`
- `package-lock.json`
- new Anchor workspace files under a repo-local Solana program directory
- new shared TypeScript helper module for program ID validation, app ID hashing, and PDA derivation
- program-facing tests for the account model and helper logic

## Implementation Steps

1. Add the Solana/Anchor tooling needed by this repo.
   - Add the minimum dependencies needed for:
     - Solana public key and keypair utilities
     - PDA derivation
     - Anchor program authoring and client artifacts
   - Keep the runtime dependency surface minimal. Do not add local-validator orchestration in this WO.

2. Create the Hello Celeris program.
   - Add an Anchor program with two instructions:
     - `initialize_app`
     - `say_hello`
   - The program is intended for Solana devnet deployment only in this slice.

3. Define the canonical app PDA rule.
   - Do not use the raw UUID string directly as a PDA seed because it exceeds the 32-byte seed limit.
   - Hash the Celeris `appId` with SHA-256 to a 32-byte `app_id_hash`.
   - Derive the app state PDA with:
     - seed `"app_state"`
     - seed `app_id_hash`
     - the deployed program ID
   - Add a shared TypeScript helper that computes:
     - `app_id_hash`
     - `statePda`

4. Define the on-chain app state model.
   - Store:
     - `app_id_hash`
     - `authority`
     - `entry_count`
     - `entries`
   - `authority` is the sponsor-wallet public key that later backend work orders will provision per app.
   - `entry_count` is the number of appended greetings.

5. Define the greeting entry model.
   - Each entry stores:
     - `player_wallet`
     - `username`
     - `message`
     - `created_at_unix_seconds`
   - The program must treat `username` as max 32 UTF-8 bytes.
   - The program must render `message` canonically on chain as:
     - `"<username> says Hello Celeris!"`
   - The instruction must not accept arbitrary message text from the caller.

6. Define the sponsor-authority model.
   - `initialize_app` requires a signer and stores that signer as `authority`.
   - `say_hello` requires the same authority signer and rejects mismatches.
   - The player wallet is recorded as data for the greeting entry, but the player is not required to sign in this slice.
   - This matches the intended runtime split where Celeris authenticates the player off chain and the sponsor wallet pays/signs on chain.

7. Define the fixed-capacity storage rule.
   - Preallocate enough account space for 100 greeting entries.
   - Reject `say_hello` once the vector is full.
   - Do not add resizing, pagination, rollover, or archival behavior in this WO.

8. Add shared TS helpers for later backend use.
   - Add a helper module that exposes:
     - Solana public-key parsing for program IDs
     - app ID hashing
     - state PDA derivation
     - canonical message rendering
   - Later work orders must reuse this helper instead of duplicating logic in services.

## Acceptance Criteria

- The repo contains an Anchor program for Hello Celeris.
- The PDA derivation rule is fixed and shared with TypeScript helpers.
- The app authority model is explicit and sponsor-wallet-compatible.
- `say_hello` stores canonical greeting messages and does not accept arbitrary freeform message text.
- The program rejects writes after 100 greeting entries.

## Unit Test Cases

- app ID hashing produces a stable 32-byte value for a given UUID string
- PDA derivation is deterministic for a given `appId` and program ID
- canonical message rendering always returns `"<username> says Hello Celeris!"`
- username validation rejects empty or oversized input
- the program rejects `say_hello` once the max entry count is reached

## Integration Test Cases

- `initialize_app` creates the app state account with the expected authority
- `say_hello` appends a greeting entry with:
  - the provided player wallet
  - the canonical message
  - the current timestamp
- `say_hello` rejects calls signed by a non-authority wallet
