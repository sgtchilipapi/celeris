import { randomUUID } from "node:crypto";
import type { Asset, MemoryStore, UUID } from "../types.js";

export class AssetService {
  readonly store: MemoryStore;

  constructor({ store }: { store: MemoryStore }) {
    this.store = store;
  }

  createHeldAsset({
    appId,
    userId,
    itemDefId,
    transactionId,
    idempotencyKey
  }: {
    appId: UUID;
    userId: UUID;
    itemDefId: string;
    transactionId: UUID;
    idempotencyKey: string;
  }): Asset {
    const cached = this.store.getIdempotent<Asset>(`asset:${appId}:${userId}`, idempotencyKey);
    if (cached) {
      return cached;
    }

    const asset = this.store.createAsset({
      assetId: randomUUID(),
      appId,
      userId,
      itemDefId,
      transactionId,
      status: "held",
      createdAt: new Date().toISOString()
    });

    this.store.setIdempotent(`asset:${appId}:${userId}`, idempotencyKey, asset);
    return asset;
  }
}
