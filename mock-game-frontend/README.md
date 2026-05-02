# Mock Game Frontend

Standalone player-facing frontend for the local Celeris MVP flow.

It is served separately from the API and proxies `/api/*` requests back to the Celeris API server.
The frontend uses the browser SDK and a local mock Privy token endpoint for development-only embedded-wallet sign-in.

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
- `--allowed-chain-id=<chain-id>` optional, defaults to `eip155:1`
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
    "platformAuth": {
      "provider": "privy",
      "privyAppId": "cl-dev-privy-app"
    },
    "playerPolicy": {
      "provider": "privy",
      "allowedChainId": "eip155:1"
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
