# Sui Local Toolchain

This repo's canonical Sui work lives in [sui/hello-celeris](./hello-celeris).

## Requirements

- Install the Sui CLI locally. The package scripts in the repo assume `sui` is on your `PATH`.
- Use the repo's Node dependency surface, which now includes `@mysten/sui` for transaction building and validation helpers.

## Useful Commands

- `npm run sui:move:build`
- `npm run sui:move:test`

## Manual Publish Flow

Use the Sui CLI manually against testnet:

1. Build and test the package:
   `npm run sui:move:build`
   `npm run sui:move:test`
2. Publish `sui/hello-celeris` with your funded Sui testnet account and capture the new package ID from the CLI output.
3. Call `initialize_app` on the published package and capture the created shared `AppState` object ID plus the owned `AppAuthorityCap` object ID.
4. Register those IDs against your Celeris app with `scripts/register-sui-package.ts`.

Typical CLI shape:

```bash
sui client publish --gas-budget <gas-budget> sui/hello-celeris

sui client call \
  --package <package-id> \
  --module hello_celeris \
  --function initialize_app \
  --args <app-id> \
  --gas-budget <gas-budget>
```

If your workstation already has a funded Sui testnet account configured in the Sui CLI, the repo-level `npm run start:full-demo` command can drive the publish, initialize, register, and frontend bootstrap sequence for you.

## Notes

- This work order targets Sui testnet, not localnet.
- The Move package uses the upstream Sui framework dependency from `framework/testnet`.
