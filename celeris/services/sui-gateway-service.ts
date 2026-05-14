import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { SuiGateway, SuiGasCoin, VerifiedSuiDigest } from "../types.js";
import { AppError } from "./errors.js";

export class SuiGatewayService implements SuiGateway {
  readonly client: SuiJsonRpcClient;
  readonly explorerBaseUrl: string;

  constructor({
    client,
    explorerBaseUrl = "https://suiexplorer.com/txblock"
  }: {
    client: SuiJsonRpcClient;
    explorerBaseUrl?: string;
  }) {
    this.client = client;
    this.explorerBaseUrl = explorerBaseUrl.replace(/\/+$/, "");
  }

  getBuildClient() {
    return this.client as never;
  }

  async getCurrentEpoch() {
    const systemState = await this.client.getLatestSuiSystemState();
    return String(systemState.epoch);
  }

  async getReferenceGasPrice() {
    return String(await this.client.getReferenceGasPrice());
  }

  async getChainIdentifier() {
    return this.client.core.getChainIdentifier().then((result) => result.chainIdentifier);
  }

  async listSponsorGasCoins(owner: string): Promise<SuiGasCoin[]> {
    const coins = await this.client.core.listCoins({ owner, coinType: "0x2::sui::SUI" });
    return coins.objects.map((coin) => ({
      objectId: coin.objectId,
      digest: coin.digest,
      version: String(coin.version)
    }));
  }

  async getObjectReference(objectId: string) {
    const result = await this.client.core.getObjects({ objectIds: [objectId] });
    const object = result.objects[0];
    if (!object || object instanceof Error) {
      throw new AppError(422, "required Sui object reference could not be resolved", { objectId });
    }
    const owner = object.owner as { $kind?: string; Shared?: { initialSharedVersion: string } } | null;
    return {
      objectId: object.objectId,
      digest: object.digest,
      version: String(object.version),
      initialSharedVersion: owner?.$kind === "Shared" ? owner.Shared?.initialSharedVersion ?? null : null
    };
  }

  async verifySubmittedDigest(input: {
    digest: string;
    expectedSender: string;
    expectedSponsorAddress: string;
  }): Promise<VerifiedSuiDigest> {
    try {
      const transaction = await this.client.getTransactionBlock({
        digest: input.digest,
        options: {
          showInput: true,
          showEffects: true
        }
      });
      const actualSender = (transaction as any)?.transaction?.data?.sender;
      if (typeof actualSender === "string" && actualSender !== input.expectedSender) {
        throw new AppError(422, "reported digest sender does not match the authenticated player");
      }

      const gasOwner = (transaction as any)?.effects?.gasObject?.owner?.AddressOwner;
      if (typeof gasOwner === "string" && gasOwner !== input.expectedSponsorAddress) {
        throw new AppError(422, "reported digest gas owner does not match the sponsor wallet");
      }

      const effectStatus = (transaction as any)?.effects?.status?.status;
      const status = effectStatus === "failure" ? "failed" : "success";
      return {
        digest: input.digest,
        status,
        explorerUrl: `${this.explorerBaseUrl}/${input.digest}?network=testnet`,
        confirmedAt: new Date().toISOString()
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(422, "reported digest could not be verified through Sui RPC", {
        digest: input.digest,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
