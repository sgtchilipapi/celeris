export const DEFAULT_SUI_RPC_ORIGIN: string;

export function isSayHelloSubmissionReady(input: {
  hasSession: boolean;
  hasAction: boolean;
  username: string;
  pendingAction: boolean;
}): boolean;

export function getTransactionDisplayModel(
  transaction: {
    transactionId: string;
    actionId: string;
    digest: string | null;
    providerTxId: string | null;
    explorerUrl: string | null;
    walletAddress: string;
    username: string | null;
    message: string | null;
    status: string;
    submittedAt: string;
    confirmedAt: string | null;
  },
  formatTimestamp: (value: string) => string
): {
  walletAddress: string;
  username: string;
  message: string;
  status: string;
  timestamp: string;
  digestLabel: string;
  explorerUrl: string | null;
};
