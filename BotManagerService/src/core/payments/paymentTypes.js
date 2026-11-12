const PaymentStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
};

// A payment that reached COMPLETED or FAILED is done: either the customer was
// told it failed/timed out, or they already paid. Both are irreversible as far
// as "can this still become a successful payment" goes, which is the rule
// PaymentStore.appendEvent enforces on every write.
const TERMINAL_STATUSES = [PaymentStatus.COMPLETED, PaymentStatus.FAILED];

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

function normalizeStatus(status) {
  const normalizedStatusText = String(status || '').toUpperCase();
  if (!normalizedStatusText) return PaymentStatus.PENDING;

  // Common provider variants
  if (['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID'].includes(normalizedStatusText)) return PaymentStatus.COMPLETED;
  if (['FAIL', 'FAILED', 'CANCELLED', 'CANCELED', 'ERROR'].includes(normalizedStatusText)) return PaymentStatus.FAILED;
  if (['PROCESSING', 'IN_PROGRESS'].includes(normalizedStatusText)) return PaymentStatus.PROCESSING;
  if (['PENDING', 'INITIATED'].includes(normalizedStatusText)) return PaymentStatus.PENDING;

  return PaymentStatus.PENDING;
}

module.exports = { PaymentStatus, normalizeStatus, isTerminalStatus, TERMINAL_STATUSES };
