const PaymentStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED'
};

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

module.exports = { PaymentStatus, normalizeStatus };
