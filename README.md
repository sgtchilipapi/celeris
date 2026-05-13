# Celeris

Celeris handles hosted player auth, wallet-keyed credits, and managed on-chain action execution for web3 games.

The canonical demo flow is now the Solana devnet Hello Celeris slice:

- hosted Celeris auth wrapping Privy
- wallet address and credit balance
- a paid `say_hello` managed action
- a sponsor-wallet-backed Solana devnet transaction
- an app-wide transaction feed with Explorer links

## Local services

- API: `npm run dev`
- Standalone player frontend: `npm run dev:mock-game-frontend -- --app-id=<app-id>`

For a real Stripe-hosted checkout in test mode, create a local `.env` or `.env.local` from [.env.example](.env.example) and set `STRIPE_SECRET_KEY`.
Without it, checkout session creation stays in local mock mode.

Hosted browser login expects Privy runtime configuration at startup.
Set `CELERIS_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `CELERIS_PRIVY_GOOGLE_LOGIN_ENABLED=true`, and `CELERIS_SESSION_SECRET` in local `.env` or `.env.local` before running the API outside tests.
`PRIVY_VERIFIER_SECRET` remains accepted as a legacy alias, but the runtime now uses the Privy app secret server-side.

## Canonical manual flow

Use this sequence for the supported devnet Hello Celeris demo:

1. Start the API with `npm run dev`.
2. Create a developer app through the developer API or dashboard.
3. Provision the app sponsor wallet:

```bash
node --import tsx scripts/provision-sponsor-wallet.ts \
  --app-id=<app-id> \
  --username=<developer-username> \
  --password=<developer-password>
```

4. Fund the returned sponsor-wallet public key with devnet SOL.
5. Deploy the in-repo Anchor program to Solana devnet.
6. Register the deployed program:

```bash
node --import tsx scripts/register-program.ts \
  --app-id=<app-id> \
  --program-id=<deployed-program-id> \
  --username=<developer-username> \
  --password=<developer-password>
```

7. Configure the paid `say_hello` action with execution mode `managed`.
8. Start the standalone frontend:

```bash
npm run dev:mock-game-frontend -- --app-id=<app-id>
```

9. Sign in through hosted auth.
10. Buy credits through the mock checkout path.
11. Execute `Say Hello Celeris`.
12. Inspect the resulting signature in Solana Explorer.

The helper scripts also accept `--access-token=<developer-access-token>` instead of username/password auth.

## Retired path

`npm run start:full-demo` is intentionally retired for this slice.
The repo no longer treats one-command demo orchestration as the canonical path because it conflicts with the manual devnet sponsor-wallet flow.

## References

- [docs/solana-devnet-hello-demo-plan.md](docs/solana-devnet-hello-demo-plan.md)
- [docs/WORK_ORDERS/SDH-context.md](docs/WORK_ORDERS/SDH-context.md)
- [mock-game-frontend/README.md](mock-game-frontend/README.md)
