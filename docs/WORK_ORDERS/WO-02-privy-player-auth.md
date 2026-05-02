# WO-02 Privy Player Auth And Wallet Principal

## Objective

Replace the existing player auth model with Privy-authenticated wallet identity and hard-cut all player-facing username/password or dummy-email auth routes.

This work order establishes the wallet principal used by every player-facing API request.

## Scope

In scope:

- Privy-backed player auth verification
- wallet principal extraction
- removal of legacy player auth routes
- introduction of the first player-scoped `v1` endpoints

Out of scope:

- checkout behavior
- managed action execution
- player demo UI migration

## Dependencies

- `WO-01`

## Affected Files / Modules

- `celeris/services/auth-service.ts` (delete or replace)
- `celeris/services/privy-auth-service.ts` (new)
- `celeris/api/index.ts`
- `celeris/api/create-api.ts`
- `celeris/types.ts`
- `celeris/db/memory-store.ts`
- `celeris/tests/auth-session.test.ts` (replace)
- `celeris/tests/privy-player-auth.test.ts` (new)

## Implementation Steps

1. Delete the current player auth contract.
   - Remove `POST /auth/session`.
   - Remove `POST /player/sign-up`.
   - Remove `POST /player/sign-in`.
   - Remove player username/password account creation from runtime contracts.

2. Add `celeris/services/privy-auth-service.ts`.
   - Accept bearer tokens from player routes.
   - Verify the token through a pluggable Privy verifier abstraction.
   - Resolve `WalletPrincipal` from verified claims.
   - Fail closed on:
     - missing token
     - invalid token
     - missing wallet address
     - unsupported chain

3. Replace old auth types.
   - Remove `PlayerAccount`, `CreateSessionRequest`, `SessionResponse`, and player-specific `AuthenticatedSession` contracts.
   - Add Privy claim / wallet-principal types needed by the service.

4. Rewrite `celeris/api/index.ts` and `celeris/api/create-api.ts`.
   - Inject `PrivyAuthService` instead of the old player auth service.
   - Add `GET /v1/me`.
   - Add `GET /v1/apps/:appId/me/credits`.
   - Ensure both routes resolve player identity from bearer token only.
   - Do not accept request body player identifiers.

5. Remove player session persistence assumptions from `celeris/db/memory-store.ts`.
   - Remove storage for player usernames/passwords and player sessions if they are no longer used anywhere after this WO.
   - Keep developer account storage untouched.

6. Replace the auth test suite.
   - Delete or fully rewrite `auth-session.test.ts`.
   - Add `privy-player-auth.test.ts`.

## Acceptance Criteria

- The runtime has no player sign-up or player sign-in route based on usernames, passwords, or dummy email.
- `GET /v1/me` returns a wallet principal derived from the authenticated Privy session.
- `GET /v1/apps/:appId/me/credits` returns the wallet-owned balance record.
- Any attempt to spoof wallet identity through request body fields is rejected.
- The runtime has no remaining dependency on legacy player accounts.

## Unit Test Cases

- `PrivyAuthService` accepts a valid Privy token and returns the expected `WalletPrincipal`.
- `PrivyAuthService` rejects:
  - missing token
  - malformed token
  - missing wallet claim
  - unsupported chain
- The request auth helper in `create-api.ts` derives wallet principal from bearer token only.

## Integration Test Cases

- `GET /v1/me` returns wallet address and chain for a valid token.
- `GET /v1/me` returns `401` for missing or invalid token.
- `GET /v1/apps/:appId/me/credits` returns a zero-balance record for a valid token with no prior payments.
- Supplying a conflicting `walletAddress` or `userId` in request input does not affect route behavior and is rejected if validated.
