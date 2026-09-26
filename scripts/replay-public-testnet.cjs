'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {ethers} = require('../consumer/node_modules/ethers');

const root = path.resolve(__dirname, '..');
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'evidence/metropolis_claims.json'), 'utf8'));
const row = evidence.publicTestnetExecution;
const rpc = process.env.MONAD_TESTNET_RPC_URL || 'https://testnet-rpc.monad.xyz';

(async () => {
  const provider = new ethers.JsonRpcProvider(rpc, 10143, {staticNetwork: true});
  assert.equal(Number((await provider.getNetwork()).chainId), 10143);
  for (const address of [row.host, row.mockBase, row.mockQuote]) {
    assert.notEqual(await provider.getCode(address), '0x', `missing code at ${address}`);
  }

  let submittedTotal = 0n;
  let gasUsedTotal = 0n;
  let chargedTotal = 0n;
  for (const [label, hash, expectedLimit] of row.transactions) {
    const [transaction, receipt] = await Promise.all([
      provider.getTransaction(hash),
      provider.getTransactionReceipt(hash)
    ]);
    assert.ok(transaction && receipt, `${label}: missing transaction or receipt`);
    assert.equal(receipt.status, 1, `${label}: failed receipt`);
    assert.equal(transaction.gasLimit, BigInt(expectedLimit), `${label}: submitted limit mismatch`);
    submittedTotal += transaction.gasLimit;
    gasUsedTotal += receipt.gasUsed;
    chargedTotal += transaction.gasLimit * receipt.gasPrice;
  }
  assert.equal(submittedTotal, BigInt(row.submittedGasLimitTotal));
  assert.equal(gasUsedTotal, BigInt(row.receiptGasUsedDiagnosticTotal));
  assert.equal(chargedTotal, BigInt(row.chargedWei));

  const host = new ethers.Contract(row.host, ['function lockedBaseRaw() view returns (uint256)'], provider);
  const tokenAbi = ['function balanceOf(address) view returns (uint256)'];
  const base = new ethers.Contract(row.mockBase, tokenAbi, provider);
  const quote = new ethers.Contract(row.mockQuote, tokenAbi, provider);
  assert.equal(await host.lockedBaseRaw(), 0n);
  assert.equal(await base.balanceOf(row.host), 0n);
  assert.equal(await quote.balanceOf(row.host), 0n);

  console.log('PUBLIC TESTNET KEYLESS REPLAY PASS');
  console.log('checked=chain_id_10143');
  console.log('checked=nonempty_code_at_host_base_quote (existence only; not runtime hash)');
  console.log(`checked=receipt_status_and_submitted_limit ${row.transactions.length}/${row.transactions.length}`);
  console.log(`submitted_gas_limit_total=${submittedTotal}`);
  console.log(`receipt_gas_used_diagnostic_total=${gasUsedTotal}`);
  console.log(`charged_wei=${chargedTotal}`);
  console.log('checked=current_host_locked_base_base_balance_quote_balance_are_zero');
  console.log('not_checked=runtime_hash,immutable_ticks,event_order,historical_actor_balances');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
