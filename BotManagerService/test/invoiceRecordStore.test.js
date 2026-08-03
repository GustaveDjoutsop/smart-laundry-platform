const test = require('node:test');
const assert = require('node:assert/strict');

const { InvoiceRecordStore } = require('../src/core/invoices/invoiceRecordStore');

function fakePool(queryImpl) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return queryImpl ? queryImpl(sql, params) : { rows: [{ id: 1, invoice_number: 'AFROMARKET-tx1' }] };
    }
  };
}

test('InvoiceRecordStore.insert requires botId, transactionId and provider', async () => {
  const store = new InvoiceRecordStore({ pool: fakePool() });

  await assert.rejects(
    () => store.insert({ transactionId: 'tx1', provider: 'stripe', amount: 10, currency: 'EUR' }),
    /requires botId, transactionId and provider/
  );
});

test('InvoiceRecordStore.insert requires amount and currency', async () => {
  const store = new InvoiceRecordStore({ pool: fakePool() });

  await assert.rejects(
    () => store.insert({ botId: 'afromarket', transactionId: 'tx1', provider: 'stripe' }),
    /requires amount and currency/
  );
});

test('InvoiceRecordStore.insert derives an invoice_number from botId + transactionId and computes retain_until in SQL', async () => {
  const pool = fakePool();
  const store = new InvoiceRecordStore({ pool });

  await store.insert({
    botId: 'afromarket',
    transactionId: 'tx1',
    provider: 'stripe',
    buyerName: 'Jane Doe',
    buyerAddress: '12 Main St',
    buyerPhone: '+491701234567',
    lineItems: [{ productId: 'rice_1kg', qty: 2 }],
    amount: 12.5,
    currency: 'EUR',
    taxStatus: '§ 19 UStG',
    paymentReference: 'pi_123'
  });

  assert.equal(pool.calls.length, 1);
  const { sql, params } = pool.calls[0];
  assert.match(sql, /INSERT INTO invoice_record/);
  assert.match(sql, /retain_until/);
  assert.match(sql, /now\(\) \+ interval '10 years'/);
  assert.equal(params[0], 'AFROMARKET-tx1');
  assert.equal(params[1], 'afromarket');
  assert.equal(params[2], 'tx1');
  assert.equal(params[3], 'stripe');
  assert.equal(params[7], JSON.stringify([{ productId: 'rice_1kg', qty: 2 }]));
});

test('InvoiceRecordStore has no update or delete method - append-only is enforced at the code level', () => {
  const store = new InvoiceRecordStore({ pool: fakePool() });

  assert.equal(store.update, undefined);
  assert.equal(store.delete, undefined);
});
