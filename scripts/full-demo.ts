import { fileURLToPath } from "node:url";

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

export function getRetiredFullDemoMessage() {
  return [
    "scripts/full-demo.ts is retired for the Solana devnet Hello Celeris flow.",
    "Use the canonical manual sequence instead:",
    "1. Start the API with npm run dev.",
    "2. Create a developer app.",
    "3. Provision the app sponsor wallet with scripts/provision-sponsor-wallet.ts.",
    "4. Fund that sponsor wallet with devnet SOL.",
    "5. Register the deployed program with scripts/register-program.ts.",
    "6. Configure the paid say_hello action.",
    "7. Start the standalone frontend with npm run dev:mock-game-frontend -- --app-id=<app-id>."
  ].join("\n");
}

async function main() {
  console.log(getRetiredFullDemoMessage());
}

if (isMainModule) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
