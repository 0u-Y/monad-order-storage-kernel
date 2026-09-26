'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {json, PACKAGE_SHA256, KERNEL_SHA256} = require('./lib.cjs');
const local = require('./local.cjs');
const monad = require('./monad-ten.cjs');

const root = path.resolve(__dirname, '..');
const output = process.env.BENCHMARK_OUT || path.join(__dirname, 'output');
const recorded = JSON.parse(fs.readFileSync(path.join(root, 'evidence/metropolis_claims.json'), 'utf8'));
const started = Date.now();

function runAudit(script) {
  return execFileSync(process.execPath, [path.join(root, script)], {encoding: 'utf8'}).trim();
}

function historicalRow(id) {
  const aliases = {
    'maker-refresh-2+2-active64': 'maker-two-tick-2plus2-active64',
    'taker-1-fill-active33': 'taker-1-fill-active33-counterexample',
    'maker-refresh-1+1-active256': 'maker-two-tick-1plus1-active256-counterexample'
  };
  return recorded.fixedBlockReadOnly.wholeHostComparisons.find(row => row.id === (aliases[id] || id));
}

async function main() {
  fs.mkdirSync(output, {recursive: true});
  const sourceAudit = runAudit('scripts/verify-source-lock.cjs');
  const recordedAudit = runAudit('scripts/verify-metropolis-evidence.cjs');
  const localResult = await local.run(output);
  let monadResult = null;
  let rpcBlocker = null;
  if (process.env.BENCHMARK_SKIP_RPC === '1') {
    rpcBlocker = 'SKIPPED_BY_BENCHMARK_SKIP_RPC';
  } else {
    try {
      monadResult = await monad.run(output);
    } catch (error) {
      rpcBlocker = error.stack || error.message;
      fs.writeFileSync(path.join(output, 'monad-ten-blocked.json'), json({status: 'BLOCKED', reason: rpcBlocker}));
    }
  }

  const equivalence = Object.fromEntries(localResult.equivalence.map(row => [row.id, row.status]));
  const table = (monadResult?.comparisons || []).map(row => {
    assert.equal(equivalence[row.id], 'PASS', `${row.id}: performance row lacks local semantic equivalence`);
    const old = historicalRow(row.id);
    return {
      fixture: row.id,
      equivalence: 'PASS',
      contiguousEstimate: row.contiguousEstimate,
      linkedEstimate: row.linkedEstimate,
      contiguousVsLinkedPercent: row.contiguousVsLinkedPercent,
      result: row.result,
      suggestedLimits: `${row.contiguousSuggestedLimit}/${row.linkedSuggestedLimit}`,
      previousRecordedEstimate: old ? `${old.contiguousEstimate}/${old.linkedEstimate}` : 'N/A',
      changedFromRecorded: old ? (BigInt(old.contiguousEstimate) !== BigInt(row.contiguousEstimate) || BigInt(old.linkedEstimate) !== BigInt(row.linkedEstimate)) : 'N/A'
    };
  });
  const summary = {
    status: monadResult ? 'PASS' : 'LOCAL_PASS_RPC_BLOCKED',
    frozenIdentity: {packageSha256: PACKAGE_SHA256, kernelSha256: KERNEL_SHA256},
    audits: {
      sourceDistribution: sourceAudit,
      recordedEvidence: recordedAudit,
      recordedTestnetReceiptRegression: `${recorded.publicTestnetExecution.successfulReceiptCount}/${recorded.publicTestnetExecution.receiptCount} stored receipt invariants audited; live chain replay not part of this command`
    },
    localEquivalence: localResult.equivalence,
    monadTen: monadResult ? {status: monadResult.status, block: monadResult.block, rpcAccounting: monadResult.rpcAccounting} : {status: 'BLOCKED', reason: rpcBlocker},
    table,
    staleCounterexample: monadResult?.staleCounterexample || 'N/A_RPC_BLOCKED',
    metricBoundary: {
      estimate: 'read-only eth_estimateGas at the pinned block and explicit state override',
      minimumSuccessLimit: 'N/A_NOT_SEARCHED',
      suggestedLimit: '15%-buffered rounded limit validated only at the identical prestate',
      actualSubmittedLimit: 'N/A_NO_TRANSACTION',
      receiptFee: 'N/A_NO_TRANSACTION'
    },
    dependencyBytes: process.env.BENCHMARK_DEPENDENCY_BYTES || 'UNKNOWN',
    durationMs: Date.now() - started,
    notClaimed: ['page locality as sole cause', 'Kuru advantage', 'TPS', 'actual transaction fee savings', 'universal safe gas limit']
  };
  fs.writeFileSync(path.join(output, 'summary.json'), json(summary));

  console.log(sourceAudit.split('\n')[0]);
  console.log(recordedAudit.split('\n')[0]);
  console.log(`LOCAL FUNCTIONAL EQUIVALENCE PASS (${localResult.equivalence.length}/5 fixtures)`);
  if (monadResult) {
    console.table(table.map(row => ({
      fixture: row.fixture,
      equivalent: row.equivalence,
      contiguous: row.contiguousEstimate,
      linked: row.linkedEstimate,
      'contig-v-linked': `${row.contiguousVsLinkedPercent}%`,
      outcome: row.result
    })));
    console.log(`STALE LIMIT COUNTEREXAMPLE ${monadResult.staleCounterexample.oldLimitSucceededAfterBookChange ? 'FAIL_NOT_REPRODUCED' : 'PASS_OOG_REPRODUCED'}`);
    console.log(`MONAD TEN READ-ONLY PASS (${monadResult.rpcAccounting.requests} calls, zero transactions)`);
  } else {
    console.log('MONAD TEN READ-ONLY BLOCKED; no historical values were synthesized');
  }
  console.log(`raw_results=${path.relative(root, output)}`);
  console.log(`benchmark_duration_seconds=${(summary.durationMs / 1000).toFixed(1)}`);
  console.log(summary.status === 'PASS' ? 'JUDGE BENCHMARK PASS' : 'JUDGE BENCHMARK LOCAL PASS / RPC BLOCKED');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
