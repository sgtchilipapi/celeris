import type { CreditBalance, UUID, WalletPrincipal } from "../types.js";

type TxLike = {
  oneOrNone<T>(query: string, values: unknown[]): Promise<T | null>;
  none(query: string, values: unknown[]): Promise<void>;
};

type DbLike = {
  transaction<T>(callback: (tx: TxLike) => Promise<T>): Promise<T>;
};

export class PostgresCreditBalanceRepository {
  readonly db: DbLike;

  constructor({ db }: { db: DbLike }) {
    this.db = db;
  }

  async withLockedBalance(walletPrincipal: WalletPrincipal, appId: UUID, callback: (balance: CreditBalance) => Promise<CreditBalance> | CreditBalance) {
    return this.db.transaction(async (tx) => {
      const balance = await tx.oneOrNone<{
        wallet_address: string;
        chain_id: string;
        app_id: UUID;
        balance: number;
        reserved: number;
        updated_at: string;
      }>(
        `
          SELECT wallet_address, chain_id, app_id, balance, reserved, updated_at
          FROM credit_balances
          WHERE wallet_address = $1 AND chain_id = $2 AND app_id = $3
          FOR UPDATE
        `,
        [walletPrincipal.walletAddress, walletPrincipal.chainId, appId]
      );

      const current = balance ?? {
        wallet_address: walletPrincipal.walletAddress,
        chain_id: walletPrincipal.chainId,
        app_id: appId,
        balance: 0,
        reserved: 0,
        updated_at: new Date().toISOString()
      };

      const next = await callback({
        appId: current.app_id,
        walletAddress: current.wallet_address,
        chainId: current.chain_id,
        balance: current.balance,
        reserved: current.reserved,
        updatedAt: current.updated_at
      });

      await tx.none(
        `
          INSERT INTO credit_balances (wallet_address, chain_id, app_id, balance, reserved, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (app_id, chain_id, wallet_address)
          DO UPDATE SET
            balance = EXCLUDED.balance,
            reserved = EXCLUDED.reserved,
            updated_at = NOW()
        `,
        [walletPrincipal.walletAddress, walletPrincipal.chainId, appId, next.balance, next.reserved]
      );

      return next;
    });
  }
}
