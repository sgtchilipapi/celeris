import { Keypair } from "@solana/web3.js";
import { AppError } from "../services/errors.js";
import type { MemoryStore } from "../types.js";

export function resolveAppSponsorWallet({
  store,
  appId
}: {
  store: MemoryStore;
  appId: string;
}) {
  const sponsorWallet = store.getSponsorWallet(appId);
  const sponsorWalletSecret = store.getSponsorWalletSecret(appId);

  if (!sponsorWallet || !sponsorWalletSecret) {
    throw new AppError(422, "sponsor wallet not provisioned");
  }
  if (!sponsorWallet.publicKey || typeof sponsorWalletSecret.secretKey === "string") {
    throw new AppError(422, "legacy Solana sponsor wallet material is unavailable for Sui sponsor wallets");
  }

  const keypair = Keypair.fromSecretKey(Uint8Array.from(sponsorWalletSecret.secretKey));
  if (keypair.publicKey.toBase58() !== sponsorWallet.publicKey) {
    throw new AppError(500, "stored sponsor wallet keypair does not match public summary");
  }

  return {
    sponsorWallet,
    keypair
  };
}
