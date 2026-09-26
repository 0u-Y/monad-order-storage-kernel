'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const solc = require('../consumer/node_modules/solc');
const ganache = require('../consumer/node_modules/ganache');
const {ethers} = require('../consumer/node_modules/ethers');

const root = path.resolve(__dirname, '..');
const sources = {
  'contracts/OrderStorageKernel.sol': {
    content: fs.readFileSync(path.join(root, 'contracts/OrderStorageKernel.sol'), 'utf8')
  },
  'test/KernelHarness.sol': {
    content: fs.readFileSync(path.join(root, 'test/KernelHarness.sol'), 'utf8')
  }
};
const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: {enabled: true, runs: 200},
    viaIR: true,
    evmVersion: 'shanghai',
    outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object']}}
  }
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter(row => row.severity === 'error');
assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
const artifact = output.contracts['test/KernelHarness.sol'].KernelHarness;

async function sent(value) { return (await value).wait(); }
async function rejects(call) {
  try {
    const value = await call();
    if (value && value.wait) await value.wait();
    return false;
  } catch { return true; }
}

(async () => {
  const chain = ganache.provider({
    logging: {quiet: true},
    chain: {hardfork: 'shanghai'},
    wallet: {deterministic: true, totalAccounts: 4}
  });
  const provider = new ethers.BrowserProvider(chain);
  provider.pollingInterval = 5;
  const [admin, makerA, makerB] = await Promise.all([0, 1, 2].map(i => provider.getSigner(i)));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, admin);
  const harness = await factory.deploy();
  await harness.waitForDeployment();

  const marketA = ethers.id('KERNEL-TEST-A');
  const marketB = ethers.id('KERNEL-TEST-B');
  const tick = 100n;
  await sent(harness.initialize(marketA));
  await sent(harness.initialize(marketB));

  const h1 = await harness.connect(makerA).post.staticCall(marketA, tick, 4);
  await sent(harness.connect(makerA).post(marketA, tick, 4));
  const h2 = await harness.connect(makerB).post.staticCall(marketA, tick, 6);
  await sent(harness.connect(makerB).post(marketA, tick, 6));

  const [preview, filled] = await harness.consume.staticCall(marketA, tick, 5, 2);
  assert.equal(filled, 5n);
  assert.deepEqual(preview.map(x => [x.handle, x.quantity, x.remaining]), [
    [h1, 4n, 0n],
    [h2, 1n, 5n]
  ]);
  await sent(harness.consume(marketA, tick, 5, 2));
  assert.equal((await harness.order(marketA, h2)).quantity, 5n);
  assert.equal(await rejects(() => harness.connect(makerA).cancel(marketA, h2)), true);
  await sent(harness.connect(makerB).cancel(marketA, h2));
  assert.deepEqual([...(await harness.level(marketA, tick))], [0n, 0n]);

  const reused = await harness.connect(makerA).post.staticCall(marketA, tick, 2);
  await sent(harness.connect(makerA).post(marketA, tick, 2));
  assert.equal(reused & 0xffffffffn, h2 & 0xffffffffn, 'free slot was not reused');
  assert.equal(reused >> 32n, (h2 >> 32n) + 1n, 'generation did not advance');
  assert.equal(await rejects(() => harness.order(marketA, h2)), true, 'stale handle accepted');

  const otherMarket = await harness.connect(makerB).post.staticCall(marketB, tick, 7);
  await sent(harness.connect(makerB).post(marketB, tick, 7));
  assert.equal((await harness.order(marketA, reused)).quantity, 2n);
  assert.equal((await harness.order(marketB, otherMarket)).quantity, 7n);

  assert.equal(
    await rejects(() => harness.consumeThenRevert(marketA, tick, 1, 1)),
    true,
    'forced rollback did not revert'
  );
  assert.equal((await harness.order(marketA, reused)).quantity, 2n, 'rollback changed state');

  const extra = await harness.connect(makerB).post.staticCall(marketA, tick, 2);
  await sent(harness.connect(makerB).post(marketA, tick, 2));
  assert.equal(
    await rejects(() => harness.consumeExact(marketA, tick, 3, 1)),
    true,
    'exact consume ignored maxFills'
  );
  assert.equal((await harness.order(marketA, reused)).quantity, 2n);
  assert.equal((await harness.order(marketA, extra)).quantity, 2n);

  console.log('KERNEL INVARIANT SMOKE PASS');
  await chain.disconnect();
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
