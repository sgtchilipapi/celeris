import type { AppMetrics, MemoryStore } from "../types.js";

export class MetricsService {
  readonly store: MemoryStore;

  constructor({ store }: { store: MemoryStore }) {
    this.store = store;
  }

  getAppMetrics(appId: string): AppMetrics {
    const users = [...this.store.creditBalances.values()].filter((balance) => balance.appId === appId);
    const payments = [...this.store.payments.values()].filter((payment) => payment.appId === appId && payment.status === "paid");
    const ledger = this.store.creditLedger.filter((entry) => entry.appId === appId);
    const transactions = [...this.store.transactions.values()].filter((tx) => tx.appId === appId);
    const mintCount = this.store.usageEvents.filter((event) => event.appId === appId && event.eventType === "mint_item").length;

    return {
      appId,
      totalUsers: users.length,
      totalRevenueCents: payments.reduce((sum, payment) => sum + payment.amountCents, 0),
      creditsPurchased: ledger.filter((entry) => entry.type === "grant").reduce((sum, entry) => sum + entry.amount, 0),
      creditsSpent: ledger.filter((entry) => entry.type === "capture").reduce((sum, entry) => sum + entry.amount, 0),
      mintItemCount: mintCount,
      successfulTransactions: transactions.filter((tx) => tx.status === "success").length,
      failedTransactions: transactions.filter((tx) => tx.status === "failed").length,
      users: users.map((balance) => ({
        userId: balance.userId,
        balance: balance.balance,
        reserved: balance.reserved,
        activityEvents: this.store.usageEvents.filter((event) => event.appId === appId && event.userId === balance.userId).length
      }))
    };
  }
}
