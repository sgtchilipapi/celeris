import { randomUUID } from "node:crypto";
import type { AssetDeliveryRecord, MemoryStore, UUID, WalletPrincipal } from "../types.js";

export class AssetDeliveryService {
  readonly store: MemoryStore;

  constructor({ store }: { store: MemoryStore }) {
    this.store = store;
  }

  createDeliveryRecord({
    appId,
    walletPrincipal,
    itemDefId,
    transactionId,
    idempotencyKey
  }: {
    appId: UUID;
    walletPrincipal: WalletPrincipal;
    itemDefId: string;
    transactionId: UUID;
    idempotencyKey: string;
  }): AssetDeliveryRecord {
    const cached = this.store.getIdempotent<AssetDeliveryRecord>(
      `asset-delivery:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`,
      idempotencyKey
    );
    if (cached) {
      return cached;
    }

    const delivery = this.store.createAssetDelivery({
      deliveryId: randomUUID(),
      appId,
      walletAddress: walletPrincipal.walletAddress,
      chainId: walletPrincipal.chainId,
      itemDefId,
      transactionId,
      destinationWalletAddress: walletPrincipal.walletAddress,
      status: "confirmed",
      createdAt: new Date().toISOString()
    });

    this.store.setIdempotent(
      `asset-delivery:${appId}:${walletPrincipal.chainId}:${walletPrincipal.walletAddress}`,
      idempotencyKey,
      delivery
    );
    return delivery;
  }
}
