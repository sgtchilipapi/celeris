# Mock Game Frontend

Standalone player-facing frontend for the local Celeris MVP flow.

It is served separately from the API and proxies `/api/*` requests back to the Celeris API server.

Default ports:

- Celeris API: `3000`
- Mock developer backend: `3001`
- Mock game frontend: `3002`

Run with:

```bash
npm run dev:mock-game-frontend -- --app-id=<app-id>
```

Supported arguments:

- `--app-id=<app-id>` required
- `--item-def-id=<item-def-id>` optional, defaults to `iron_sword`

Stripe test mode:

- Set `STRIPE_SECRET_KEY` in a local `.env` or `.env.local` for the API to use real Stripe-hosted Checkout
- Leave it unset to stay on the local mock checkout path
