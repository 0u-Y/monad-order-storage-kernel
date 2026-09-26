'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'evidence/metropolis_claims.json'), 'utf8'));
const digest = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
const truncate2 = value => Math.trunc(value * 100) / 100;

assert.equal(digest('contracts/OrderStorageKernel.sol'), evidence.sourceIdentity.kernelSha256);
assert.equal(digest('examples/multi-price/contracts/MultiPriceInventoryBase.sol'), evidence.sourceIdentity.multiPriceBaseSha256);
assert.equal(digest('examples/multi-price/contracts/ContiguousMultiPriceInventory.sol'), evidence.sourceIdentity.multiPriceContiguousSha256);
assert.equal(digest('evidence/baselines/LinkedMultiPriceInventory.sol'), evidence.sourceIdentity.linkedBaselineSha256);

for (const row of evidence.fixedBlockReadOnly.wholeHostComparisons) {
  const calculated = truncate2((row.linkedEstimate - row.contiguousEstimate) * 100 / row.linkedEstimate);
  assert.equal(calculated, row.contiguousSavingsPercent, `${row.id}: percentage mismatch`);
  assert.equal(row.sameLogicalPolicy, true);
}
for (const row of evidence.staleLimitCounterexamples.rows) {
  assert.equal(row.result, 'OOG');
  assert.ok(row.submittedLimitCandidate < row.inclusionStateRequiredGas, `${row.id}: limit is not below required gas`);
}
const testnet = evidence.publicTestnetExecution;
assert.equal(testnet.receiptCount, testnet.successfulReceiptCount);
assert.equal(
  BigInt(testnet.submittedGasLimitTotal) * BigInt(testnet.effectiveGasPriceWei),
  BigInt(testnet.chargedWei)
);
for (const row of testnet.selectedReceipts) {
  assert.equal(BigInt(row.submittedGasLimit) * BigInt(row.effectiveGasPriceWei), BigInt(row.chargedWei));
}

console.log('METROPOLIS RECORDED EVIDENCE AUDIT PASS');
console.log('checked=source_hashes,stored_row_arithmetic,stored_evidence_invariants');
console.log(`recorded_fixed_block_rows=${evidence.fixedBlockReadOnly.wholeHostComparisons.length}`);
console.log(`recorded_stale_limit_counterexamples=${evidence.staleLimitCounterexamples.rows.length}`);
console.log(`recorded_testnet_receipts=${testnet.successfulReceiptCount}/${testnet.receiptCount}`);
console.log('not_checked=historical_rpc_regeneration,linked_semantic_equivalence,testnet_chain_state');
