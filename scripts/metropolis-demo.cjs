'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const solc = require('../consumer/node_modules/solc');
const ganache = require('../consumer/node_modules/ganache');
const {ethers} = require('../consumer/node_modules/ethers');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const sources = {
  'contracts/MultiPriceInventoryBase.sol': {content: read('examples/multi-price/contracts/MultiPriceInventoryBase.sol')},
  'contracts/ContiguousMultiPriceInventory.sol': {content: read('examples/multi-price/contracts/ContiguousMultiPriceInventory.sol')},
  'contracts/StrictMockERC20.sol': {content: read('examples/multi-price/contracts/StrictMockERC20.sol')},
  '@monad-ac/order-storage-preview/contracts/OrderStorageKernel.sol': {content: read('contracts/OrderStorageKernel.sol')}
};
const settings = {
  optimizer: {enabled: true, runs: 200},
  viaIR: true,
  evmVersion: 'shanghai',
  outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object']}}
};
const output = JSON.parse(solc.compile(JSON.stringify({language: 'Solidity', sources, settings})));
const errors = (output.errors || []).filter(row => row.severity === 'error');
assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
const artifact = (file, name) => output.contracts[file][name];
const tokenArtifact = artifact('contracts/StrictMockERC20.sol', 'StrictMockERC20');
const hostArtifact = artifact('contracts/ContiguousMultiPriceInventory.sol', 'ContiguousMultiPriceInventory');
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
async function sent(value) { return (await value).wait(); }
async function reverts(call) {
  try {
    const tx = await call();
    if (tx && tx.wait) await tx.wait();
    return false;
  } catch { return true; }
}
const orderSnapshot = row => ({maker: row.maker, lots: row.lots, priceTick: row.priceTick, handle: row.handle});

(async () => {
  const chain = ganache.provider({logging: {quiet: true}, chain: {hardfork: 'shanghai'}, wallet: {deterministic: true, totalAccounts: 5}});
  const provider = new ethers.BrowserProvider(chain);
  provider.pollingInterval = 5;
  const [owner, makerA, makerB, taker] = await Promise.all([0, 1, 2, 3].map(i => provider.getSigner(i)));
  const [ownerAddress, makerAAddress, makerBAddress, takerAddress] = await Promise.all([owner, makerA, makerB, taker].map(x => x.getAddress()));

  const tokenFactory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.evm.bytecode.object, owner);
  const base = await tokenFactory.deploy(18);
  const quote = await tokenFactory.deploy(6);
  await Promise.all([base.waitForDeployment(), quote.waitForDeployment()]);

  const marketId = ethers.id('METROPOLIS-8-TICK-DEMO');
  const baseRawPerLot = 10n ** 16n;
  const ticks = [101n, 102n, 103n, 104n, 105n, 106n, 107n, 108n];
  const quoteRawPerLot = [10000n, 10200n, 10400n, 10600n, 10800n, 11000n, 11200n, 11400n];
  const hostFactory = new ethers.ContractFactory(hostArtifact.abi, hostArtifact.evm.bytecode.object, owner);
  const host = await hostFactory.deploy(
    await base.getAddress(), await quote.getAddress(), ownerAddress, marketId,
    baseRawPerLot, ticks, quoteRawPerLot, 2, 2, 18, 6
  );
  await host.waitForDeployment();
  const hostAddress = await host.getAddress();

  for (const [maker, address, lots] of [[makerA, makerAAddress, 20n], [makerB, makerBAddress, 10n]]) {
    await sent(base.mint(address, lots * baseRawPerLot));
    await sent(base.connect(maker).approve(hostAddress, ethers.MaxUint256));
  }
  await sent(quote.mint(takerAddress, 1_000_000n));
  await sent(quote.connect(taker).approve(hostAddress, ethers.MaxUint256));

  const high = await host.connect(makerA).post.staticCall(marketId, 102, 4);
  await sent(host.connect(makerA).post(marketId, 102, 4));
  const lowB = await host.connect(makerB).post.staticCall(marketId, 101, 3);
  await sent(host.connect(makerB).post(marketId, 101, 3));
  const lowA = await host.connect(makerA).post.staticCall(marketId, 101, 5);
  await sent(host.connect(makerA).post(marketId, 101, 5));

  const replacements = await host.connect(makerA).refresh.staticCall(marketId, [high, lowA], [103, 101], [3, 4]);
  await sent(host.connect(makerA).refresh(marketId, [high, lowA], [103, 101], [3, 4]));
  assert.equal(await reverts(() => host.connect(makerA).cancel(marketId, lowA)), true, 'old generation remained live');

  const expectedQuote = 3n * 10000n + 4n * 10000n + 1n * 10400n;
  const fills = await host.connect(taker).take.staticCall(marketId, 8, 3, expectedQuote, 8, ethers.MaxUint256);
  assert.deepEqual(fills.map(row => [row.priceTick, row.maker, row.lots, row.remainingLots]), [
    [101n, makerBAddress, 3n, 0n],
    [101n, makerAAddress, 4n, 0n],
    [103n, makerAAddress, 1n, 2n]
  ]);
  await sent(host.connect(taker).take(marketId, 8, 3, expectedQuote, 8, ethers.MaxUint256));

  const balancesAfterTake = {
    makerABase: await base.balanceOf(makerAAddress),
    makerAQuote: await quote.balanceOf(makerAAddress),
    makerBBase: await base.balanceOf(makerBAddress),
    makerBQuote: await quote.balanceOf(makerBAddress),
    takerBase: await base.balanceOf(takerAddress),
    takerQuote: await quote.balanceOf(takerAddress),
    hostBase: await base.balanceOf(hostAddress),
    hostQuote: await quote.balanceOf(hostAddress),
    lockedBase: await host.lockedBaseRaw()
  };
  assert.equal(balancesAfterTake.makerAQuote, 50_400n);
  assert.equal(balancesAfterTake.makerBQuote, 30_000n);
  assert.equal(balancesAfterTake.takerBase, 8n * baseRawPerLot);
  assert.equal(balancesAfterTake.hostQuote, 0n);
  assert.equal(balancesAfterTake.lockedBase, 2n * baseRawPerLot);

  await sent(base.configureFailure(takerAddress));
  const beforeFailure = {
    order: orderSnapshot(await host.order(marketId, replacements[0])),
    makerQuote: await quote.balanceOf(makerAAddress),
    takerQuote: await quote.balanceOf(takerAddress),
    hostBase: await base.balanceOf(hostAddress),
    hostQuote: await quote.balanceOf(hostAddress),
    lockedBase: await host.lockedBaseRaw()
  };
  assert.equal(await reverts(() => host.connect(taker).take(
    marketId, 2, 1, 20_800, 2, ethers.MaxUint256, {gasLimit: 2_000_000}
  )), true, 'late BASE payment unexpectedly succeeded');
  const afterFailure = {
    order: orderSnapshot(await host.order(marketId, replacements[0])),
    makerQuote: await quote.balanceOf(makerAAddress),
    takerQuote: await quote.balanceOf(takerAddress),
    hostBase: await base.balanceOf(hostAddress),
    hostQuote: await quote.balanceOf(hostAddress),
    lockedBase: await host.lockedBaseRaw()
  };
  assert.deepEqual(afterFailure, beforeFailure, 'failed final payment did not roll back every state delta');

  await sent(host.connect(makerA).cancel(marketId, replacements[0]));
  assert.equal(await host.lockedBaseRaw(), 0n);
  assert.equal(await base.balanceOf(hostAddress), 0n);
  assert.equal(await quote.balanceOf(hostAddress), 0n);

  console.log('METROPOLIS TWO-MINUTE DEMO PASS');
  console.log(json({
    scope: 'one-sided BASE inventory; eight configured ticks; not a CLOB',
    marketId,
    initialOrders: {makerAHigh: high, makerBLow: lowB, makerALow: lowA},
    atomicRefresh: {cancelled: [high, lowA], posted: replacements},
    fills: fills.map(row => ({priceTick: row.priceTick, handle: row.handle, maker: row.maker, lots: row.lots, remainingLots: row.remainingLots, baseRaw: row.baseRaw, quoteRaw: row.quoteRaw})),
    balancesAfterTake,
    lateTakerPaymentRollback: 'PASS',
    final: {lockedBaseRaw: await host.lockedBaseRaw(), hostBaseRaw: await base.balanceOf(hostAddress), hostQuoteRaw: await quote.balanceOf(hostAddress)}
  }));
  await chain.disconnect();
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
