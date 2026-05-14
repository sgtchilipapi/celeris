export const DEFAULT_SUI_RPC_ORIGIN = "https://fullnode.testnet.sui.io:443";

export function isSayHelloSubmissionReady({ hasSession, hasAction, username, pendingAction }) {
  return Boolean(hasSession && hasAction && !pendingAction && username.trim().length > 0);
}

export function getTransactionDisplayModel(transaction, formatTimestamp) {
  const submittedAt = transaction.confirmedAt ?? transaction.submittedAt ?? null;
  const timestampPrefix = transaction.confirmedAt ? "Confirmed" : "Submitted";

  return {
    walletAddress: transaction.walletAddress,
    username: transaction.username ?? "Unknown",
    message: transaction.message ?? `${transaction.actionId} submitted`,
    status: transaction.status,
    timestamp: submittedAt ? `${timestampPrefix} ${formatTimestamp(submittedAt)}` : "Pending confirmation",
    digestLabel: transaction.digest ? `Digest: ${transaction.digest}` : "Digest pending",
    explorerUrl: transaction.explorerUrl ?? null
  };
}
