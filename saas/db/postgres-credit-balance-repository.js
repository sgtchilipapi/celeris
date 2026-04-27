export class PostgresCreditBalanceRepository {
  constructor({ db }) {
    this.db = db;
  }

  async withLockedBalance(userId, appId, callback) {
    return this.db.transaction(async (tx) => {
      const balance = await tx.oneOrNone(
        `
          SELECT user_id, app_id, balance, reserved, updated_at
          FROM credit_balances
          WHERE user_id = $1 AND app_id = $2
          FOR UPDATE
        `,
        [userId, appId]
      );

      const current =
        balance ?? {
          user_id: userId,
          app_id: appId,
          balance: 0,
          reserved: 0,
          updated_at: new Date().toISOString()
        };

      const next = await callback({
        userId: current.user_id,
        appId: current.app_id,
        balance: current.balance,
        reserved: current.reserved,
        updatedAt: current.updated_at
      });

      await tx.none(
        `
          INSERT INTO credit_balances (user_id, app_id, balance, reserved, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (user_id, app_id)
          DO UPDATE SET
            balance = EXCLUDED.balance,
            reserved = EXCLUDED.reserved,
            updated_at = NOW()
        `,
        [userId, appId, next.balance, next.reserved]
      );

      return next;
    });
  }
}
