# Mock Game Frontend

Standalone player-facing frontend for the local Celeris MVP flow.

It is served separately from the API and proxies `/api/*` requests back to the Celeris API server.
The frontend uses the browser SDK and the hosted Celeris auth gateway flow for player sign-in.
Hosted login expects the API runtime to be configured with `CELERIS_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, and `CELERIS_SESSION_SECRET`.
The frontend never uses a raw Privy token against player routes. Hosted login returns a one-time auth code that the browser SDK exchanges for a Celeris player session.
The frontend serves `/auth/callback` from the same app bundle so the browser SDK can own callback parsing, state validation, auth-code exchange, and popup or redirect completion without custom app auth code.

Default ports:

- Celeris API: `3000`
- Mock game frontend: `3002`

Run with:

```bash
npm run dev:mock-game-frontend -- --app-id=<app-id>
```

Supported arguments:

- `--app-id=<app-id>` required
- `--app-name=<app-name>` optional, defaults to `Mock Game`
- `--program-id=<program-id>` optional, defaults to `core_gameplay`
- `--allowed-chain-id=<chain-id>` optional, defaults to `solana:103`
- `--first-time-claim-action-id=<action-id>` optional, defaults to `first_time_claim`
- `--claim-rewards-action-id=<action-id>` optional, defaults to `claim_rewards`
- `--mint-item-action-id=<action-id>` optional, defaults to `mint_item`
- `--item-def-id=<item-def-id>` optional, defaults to `iron_sword`

The frontend config served from `/config.json` is shaped like:

```json
{
  "celeris": {
    "appId": "app-id",
    "appName": "Mock Game",
    "programId": "core_gameplay",
    "authGateway": {
      "hostedAuthOrigin": "http://localhost:3000",
      "redirectUri": "http://localhost:3002/auth/callback"
    },
    "playerPolicy": {
      "provider": "privy",
      "allowedChainId": "solana:103"
    },
    "actionIds": {
      "firstTimeClaim": "first_time_claim",
      "claimRewards": "claim_rewards",
      "mintItem": "mint_item"
    }
  },
  "itemDefId": "iron_sword"
}
```

Stripe test mode:

- Set `STRIPE_SECRET_KEY` in a local `.env` or `.env.local` for the API to use real Stripe-hosted Checkout
- Leave it unset to stay on the local mock checkout path, which completes through the standalone frontend server instead of an API demo helper route
