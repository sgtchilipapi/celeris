# Sui Local Toolchain

This repo's canonical Sui work lives in [sui/hello-celeris](./hello-celeris).

## Requirements

- Install the Sui CLI locally. The package scripts in the repo assume `sui` is on your `PATH`.
- Use the repo's Node dependency surface, which now includes `@mysten/sui` for transaction building and validation helpers.

## Useful Commands

- `npm run sui:move:build`
- `npm run sui:move:test`

## Notes

- This work order targets Sui testnet, not localnet.
- The Move package uses the upstream Sui framework dependency from `framework/testnet`.
