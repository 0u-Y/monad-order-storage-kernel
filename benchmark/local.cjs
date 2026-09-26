'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ganache = require('ganache');
const {ethers} = require('ethers');
const {CONFIG, EXPECTED_SOLC, SETTINGS, compile, hostArgs, json} = require('./lib.cjs');

const MARKET = CONFIG.marketId;
const MAX = ethers.MaxUint256;

class QueueModel {
  constructor() {
    this.levels = new Map(CONFIG.ticks.map(tick => [tick.toString(), []]));
    this.orders = new Map();
  }
  post(logicalId, handle, maker, tick, lots) {
    const order = {logicalId, handle, maker: maker.toLowerCase(), tick: BigInt(tick), lots: BigInt(lots)};
    this.levels.get(order.tick.toString()).push(order);
    this.orders.set(logicalId, order);
  }
  cancel(logicalId, maker) {
    const order = this.orders.get(logicalId);
    assert.ok(order, `model missing ${logicalId}`);
    assert.equal(order.maker, maker.toLowerCase());
    const level = this.levels.get(order.tick.toString());
    level.splice(level.indexOf(order), 1);
    this.orders.delete(logicalId);
    return order;
  }
  previewTake(maxLots, maxFills) {
    let left = BigInt(maxLots);
    const fills = [];
    for (const tick of CONFIG.ticks) {
      for (const order of this.levels.get(tick.toString())) {
        if (left === 0n || fills.length === maxFills) break;
        const lots = order.lots < left ? order.lots : left;
        const remaining = order.lots - lots;
        if (remaining !== 0n && remaining < CONFIG.minimumResidualLots) throw new Error('model residual');
        fills.push({logicalId: order.logicalId, maker: order.maker, tick, lots, remaining});
        left -= lots;
      }
      if (left === 0n || fills.length === maxFills) break;
    }
    return fills;
  }
  applyFills(fills) {
    for (const fill of fills) {
      const order = this.orders.get(fill.logicalId);
      assert.ok(order);
      order.lots = fill.remaining;
      if (order.lots === 0n) {
        this.levels.get(order.tick.toString()).shift();
        this.orders.delete(fill.logicalId);
      }
    }
  }
  queue() {
    return Object.fromEntries(CONFIG.ticks.map(tick => [tick.toString(), this.levels.get(tick.toString()).map(order => ({logicalId: order.logicalId, maker: order.maker, lots: order.lots.toString()}))]));
  }
}

const sent = async promise => (await promise).wait();
const normalize = value => JSON.parse(json(value));

async function deployFixture(build, provider, signers, kind) {
  const [admin, recovery] = signers;
  const tokenFactory = new ethers.ContractFactory(build.artifacts.token.abi, build.artifacts.token.evm.bytecode.object, admin);
  const base = await tokenFactory.deploy(18);
  const quote = await tokenFactory.deploy(6);
  await Promise.all([base.waitForDeployment(), quote.waitForDeployment()]);
  const host = await new ethers.ContractFactory(build.artifacts[kind].abi, build.artifacts[kind].evm.bytecode.object, admin)
    .deploy(...hostArgs(await base.getAddress(), await quote.getAddress(), await recovery.getAddress()));
  await host.waitForDeployment();
  return {kind, provider, signers, base, quote, host, model: new QueueModel(), handleToLogical: new Map(), nextLogical: 1};
}

async function fund(fixture, signer, baseLots = 0n, quoteRaw = 0n) {
  const account = await signer.getAddress();
  const host = await fixture.host.getAddress();
  if (baseLots > 0n) {
    await sent(fixture.base.mint(account, baseLots * CONFIG.baseRawPerLot));
    await sent(fixture.base.connect(signer).approve(host, MAX));
  }
  if (quoteRaw > 0n) {
    await sent(fixture.quote.mint(account, quoteRaw));
    await sent(fixture.quote.connect(signer).approve(host, MAX));
  }
}

async function batchPost(fixture, maker, ticks, lots) {
  if (!ticks.length) return [];
  const args = [MARKET, [], ticks, lots];
  const handles = [...await fixture.host.connect(maker).refresh.staticCall(...args)];
  await sent(fixture.host.connect(maker).refresh(...args));
  const makerAddress = await maker.getAddress();
  return handles.map((handle, index) => {
    const logicalId = `o${fixture.nextLogical++}`;
    fixture.handleToLogical.set(handle.toString(), logicalId);
    fixture.model.post(logicalId, handle, makerAddress, ticks[index], lots[index]);
    return {logicalId, handle, maker: makerAddress, tick: BigInt(ticks[index]), lots: BigInt(lots[index])};
  });
}

function logicalHandle(fixture, handle) {
  return fixture.handleToLogical.get(BigInt(handle).toString()) || `unknown:${handle}`;
}

function parseEvents(fixture, receipt) {
  const kernelEvents = new ethers.Interface([
    'event KernelOrderConsumed(bytes32 indexed marketId,uint64 indexed priceTick,uint96 indexed handle,address maker,uint96 fillQuantity,uint96 remainingQuantity)'
  ]);
  const rows = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== fixture.host.target.toLowerCase()) continue;
    let parsed;
    try { parsed = fixture.host.interface.parseLog(log); } catch {}
    if (!parsed) try { parsed = kernelEvents.parseLog(log); } catch {}
    if (!parsed) continue;
    const a = parsed.args;
    if (parsed.name === 'OrderCancelled') rows.push({name: parsed.name, tick: a.priceTick, logicalId: logicalHandle(fixture, a.handle), maker: a.maker.toLowerCase(), lots: a.lots, baseRaw: a.refundedBaseRaw});
    else if (parsed.name === 'OrderPosted') rows.push({name: parsed.name, tick: a.priceTick, logicalId: logicalHandle(fixture, a.handle), maker: a.maker.toLowerCase(), lots: a.lots, baseRaw: a.baseRaw, quoteRawPerLot: a.quoteRawPerLot});
    else if (parsed.name === 'OrderRefreshed') rows.push({name: parsed.name, maker: a.maker.toLowerCase(), cancelledLots: a.cancelledLots, postedLots: a.postedLots, refundedBaseRaw: a.refundedBaseRaw, escrowedBaseRaw: a.escrowedBaseRaw});
    // The frozen kernel and historical linked baseline use different ABI input
    // names for this event, but the indexed types, topic, and positional values
    // are identical. Normalize positionally so the assertion tests the wire ABI.
    else if (parsed.name === 'KernelOrderConsumed') rows.push({name: parsed.name, tick: a[1], logicalId: logicalHandle(fixture, a[2]), maker: a[3].toLowerCase(), lots: a[4], remaining: a[5]});
    else if (parsed.name === 'TradeSettled') rows.push({name: parsed.name, tick: a.priceTick, logicalId: logicalHandle(fixture, a.handle), maker: a.maker.toLowerCase(), taker: a.taker.toLowerCase(), lots: a.lots, baseRaw: a.baseRaw, quoteRaw: a.quoteRaw, remaining: a.remainingLots});
  }
  return normalize(rows);
}

async function stateSnapshot(fixture, actors) {
  const hostAddress = await fixture.host.getAddress();
  const balances = {};
  for (const actor of actors) {
    const address = await actor.getAddress();
    balances[address.toLowerCase()] = {
      base: await fixture.base.balanceOf(address),
      quote: await fixture.quote.balanceOf(address),
      baseAllowance: await fixture.base.allowance(address, hostAddress),
      quoteAllowance: await fixture.quote.allowance(address, hostAddress)
    };
  }
  const levels = {};
  for (const tick of CONFIG.ticks) {
    const [head, tail] = await fixture.host.level(MARKET, tick);
    levels[tick.toString()] = {head: head === 0n ? null : logicalHandle(fixture, head), tail: tail === 0n ? null : logicalHandle(fixture, tail)};
  }
  return normalize({
    lockedBaseRaw: await fixture.host.lockedBaseRaw(),
    hostBase: await fixture.base.balanceOf(hostAddress),
    hostQuote: await fixture.quote.balanceOf(hostAddress),
    allocator: [...await fixture.host.allocator(MARKET)],
    balances,
    levels,
    queue: fixture.model.queue()
  });
}

async function assertUnauthorizedCancel(fixture, attacker, handle) {
  let rejected = false;
  try { await fixture.host.connect(attacker).cancel.staticCall(MARKET, handle); } catch { rejected = true; }
  assert.equal(rejected, true, 'non-maker cancel was accepted');
  return {unauthorizedCancelRejected: true};
}

async function assertOnchainModel(fixture, snapshot) {
  const rows = [];
  for (const order of fixture.model.orders.values()) {
    const view = await fixture.host.order(MARKET, order.handle);
    assert.equal(view[0].toLowerCase(), order.maker, `${order.logicalId}: maker mismatch`);
    assert.equal(view[1], order.lots, `${order.logicalId}: lots mismatch`);
    assert.equal(view[2], order.tick, `${order.logicalId}: tick mismatch`);
    rows.push({logicalId: order.logicalId, maker: order.maker, tick: order.tick, lots: order.lots});
  }
  for (const tick of CONFIG.ticks) {
    const queue = fixture.model.levels.get(tick.toString());
    assert.equal(snapshot.levels[tick.toString()].head, queue.length ? queue[0].logicalId : null, `${tick}: head mismatch`);
    assert.equal(snapshot.levels[tick.toString()].tail, queue.length ? queue[queue.length - 1].logicalId : null, `${tick}: tail mismatch`);
  }
  return normalize(rows);
}

async function setupRefresh(fixture, makers, depth) {
  const plans = Array.from({length: makers.length}, () => []);
  for (let i = 0; i < depth; i++) {
    const makerIndex = i < 8 ? 0 : 1 + (i % 3);
    plans[makerIndex].push(CONFIG.ticks[i % 2]);
  }
  for (let i = 0; i < makers.length; i++) await batchPost(fixture, makers[i], plans[i], Array(plans[i].length).fill(2n));
}

async function refreshCase(fixture, signers, depth, batch) {
  const makers = signers.slice(2, 6);
  for (const maker of makers) await fund(fixture, maker, 1000n);
  await setupRefresh(fixture, makers, depth);
  const makerAddress = (await makers[0].getAddress()).toLowerCase();
  const targets = [...fixture.model.orders.values()].filter(order => order.maker === makerAddress).slice(0, batch);
  assert.equal(targets.length, batch);
  const postTicks = Array.from({length: batch}, (_, i) => CONFIG.ticks[(i + 1) % 2]);
  const postLots = Array(batch).fill(2n);
  const cancelHandles = targets.map(order => order.handle);
  const args = [MARKET, cancelHandles, postTicks, postLots];
  const calldata = fixture.host.interface.encodeFunctionData('refresh', args);
  const actors = [signers[0], ...makers];
  const prestate = await stateSnapshot(fixture, actors);
  const authorization = await assertUnauthorizedCancel(fixture, signers[7], cancelHandles[0]);
  const handles = [...await fixture.host.connect(makers[0]).refresh.staticCall(...args)];
  for (let i = 0; i < handles.length; i++) fixture.handleToLogical.set(handles[i].toString(), `r${i + 1}`);
  const estimate = await fixture.host.connect(makers[0]).refresh.estimateGas(...args);
  const receipt = await sent(fixture.host.connect(makers[0]).refresh(...args));
  for (const target of targets) fixture.model.cancel(target.logicalId, makerAddress);
  for (let i = 0; i < handles.length; i++) fixture.model.post(`r${i + 1}`, handles[i], makerAddress, postTicks[i], postLots[i]);
  const poststate = await stateSnapshot(fixture, actors);
  poststate.onchainOrders = await assertOnchainModel(fixture, poststate);
  assert.equal(poststate.hostBase, prestate.hostBase, 'refresh changed host BASE');
  assert.equal(poststate.lockedBaseRaw, prestate.lockedBaseRaw, 'equal-size refresh changed locked BASE');
  assert.equal(poststate.balances[makerAddress].base, prestate.balances[makerAddress].base, 'equal-size refresh changed maker BASE');
  for (const target of targets) {
    let staleRejected = false;
    try { await fixture.host.order.staticCall(MARKET, target.handle); } catch { staleRejected = true; }
    assert.equal(staleRejected, true, 'cancelled handle remained live');
  }
  const events = parseEvents(fixture, receipt);
  assert.equal(events.filter(row => row.name === 'OrderCancelled').length, batch);
  assert.equal(events.filter(row => row.name === 'OrderPosted').length, batch);
  assert.equal(events.filter(row => row.name === 'OrderRefreshed').length, 1);
  return {id: depth === 256 ? 'maker-refresh-1+1-active256' : 'maker-refresh-2+2-active64', kind: fixture.kind, correctness: 'PASS', depth, batch, authorization, staleHandlesRejected: true, calldata, prestate, poststate, events, localEvmDiagnostic: {estimate, gasUsed: receipt.gasUsed}};
}

async function setupTaker(fixture, makers) {
  const plans = Array.from({length: 4}, () => []);
  for (let i = 0; i < 17; i++) plans[i % 4].push(101n);
  for (let i = 0; i < 16; i++) plans[(i + 1) % 4].push(102n);
  for (let i = 0; i < 4; i++) await batchPost(fixture, makers[i], plans[i], Array(plans[i].length).fill(2n));
}

async function takerCase(fixture, signers, fillCount) {
  const makers = signers.slice(2, 6);
  const taker = signers[6];
  for (const maker of makers) await fund(fixture, maker, 1000n);
  await fund(fixture, taker, 0n, 2_000_000n);
  await setupTaker(fixture, makers);
  const lots = BigInt(fillCount * 2);
  const low = Math.min(fillCount, 17);
  const high = fillCount - low;
  const quote = BigInt(low * 2) * 10000n + BigInt(high * 2) * 10200n;
  const args = [MARKET, lots, fillCount, quote, lots, MAX];
  const calldata = fixture.host.interface.encodeFunctionData('take', args);
  const actors = [signers[0], ...makers, taker];
  const prestate = await stateSnapshot(fixture, actors);
  const firstLive = fixture.model.orders.values().next().value;
  const authorization = await assertUnauthorizedCancel(fixture, signers[7], firstLive.handle);
  const expected = fixture.model.previewTake(lots, fillCount);
  const returned = [...await fixture.host.connect(taker).take.staticCall(...args)].map(row => ({logicalId: logicalHandle(fixture, row.handle), maker: row.maker.toLowerCase(), tick: row.priceTick, lots: row.lots, remaining: row.remainingLots}));
  assert.deepEqual(normalize(returned), normalize(expected));
  const estimate = await fixture.host.connect(taker).take.estimateGas(...args);
  const receipt = await sent(fixture.host.connect(taker).take(...args));
  fixture.model.applyFills(expected);
  const poststate = await stateSnapshot(fixture, actors);
  poststate.onchainOrders = await assertOnchainModel(fixture, poststate);
  const baseRaw = lots * CONFIG.baseRawPerLot;
  assert.equal(BigInt(prestate.hostBase) - BigInt(poststate.hostBase), baseRaw, 'host BASE delta differs from independent model');
  assert.equal(BigInt(poststate.lockedBaseRaw), BigInt(prestate.lockedBaseRaw) - baseRaw, 'locked BASE delta differs from independent model');
  const takerAddress = (await taker.getAddress()).toLowerCase();
  assert.equal(BigInt(poststate.balances[takerAddress].base) - BigInt(prestate.balances[takerAddress].base), baseRaw, 'taker BASE delta differs from independent model');
  assert.equal(BigInt(prestate.balances[takerAddress].quote) - BigInt(poststate.balances[takerAddress].quote), quote, 'taker QUOTE delta differs from independent model');
  const makerQuote = new Map();
  for (const fill of expected) makerQuote.set(fill.maker, (makerQuote.get(fill.maker) || 0n) + fill.lots * CONFIG.quoteRawPerLot[CONFIG.ticks.indexOf(fill.tick)]);
  for (const [maker, amount] of makerQuote) assert.equal(BigInt(poststate.balances[maker].quote) - BigInt(prestate.balances[maker].quote), amount, 'maker QUOTE delta differs from independent model');
  const events = parseEvents(fixture, receipt);
  const tradeEvents = events.filter(row => row.name === 'TradeSettled');
  assert.equal(tradeEvents.length, fillCount);
  assert.deepEqual(tradeEvents.map(row => ({logicalId: row.logicalId, maker: row.maker, tick: row.tick, lots: row.lots, remaining: row.remaining})), normalize(expected));
  return {id: `taker-${fillCount}-fill-active33`, kind: fixture.kind, correctness: 'PASS', authorization, activeDepth: 33, fillCount, calldata, prestate, poststate, fills: normalize(expected), events, localEvmDiagnostic: {estimate, gasUsed: receipt.gasUsed}};
}

function comparable(row) {
  return {id: row.id, correctness: row.correctness, authorization: row.authorization || null, staleHandlesRejected: row.staleHandlesRejected || null, calldata: row.calldata, prestate: row.prestate, poststate: row.poststate, fills: row.fills || null, events: row.events};
}

async function run(outputDir) {
  const started = Date.now();
  const build = compile();
  const chain = ganache.provider({logging: {quiet: true}, chain: {hardfork: 'shanghai', allowUnlimitedContractSize: true}, wallet: {deterministic: true, totalAccounts: 8, defaultBalance: 10n ** 6n}});
  const provider = new ethers.BrowserProvider(chain);
  provider.pollingInterval = 5;
  const signers = await Promise.all(Array.from({length: 8}, (_, i) => provider.getSigner(i)));
  const rows = [];
  for (const kind of ['contiguous', 'linked']) {
    const deployed = await deployFixture(build, provider, signers, kind);
    let snapshotId = await provider.send('evm_snapshot', []);
    const fresh = () => ({...deployed, model: new QueueModel(), handleToLogical: new Map(), nextLogical: 1});
    async function isolated(operation) {
      const row = await operation(fresh());
      assert.equal(await provider.send('evm_revert', [snapshotId]), true);
      snapshotId = await provider.send('evm_snapshot', []);
      return row;
    }
    rows.push(await isolated(fixture => refreshCase(fixture, signers, 64, 2)));
    for (const fills of [1, 5, 32]) rows.push(await isolated(fixture => takerCase(fixture, signers, fills)));
    rows.push(await isolated(fixture => refreshCase(fixture, signers, 256, 1)));
  }
  const equivalence = [];
  for (const id of [...new Set(rows.map(row => row.id))]) {
    const pair = rows.filter(row => row.id === id);
    assert.equal(pair.length, 2);
    const left = comparable(pair[0]);
    const right = comparable(pair[1]);
    assert.deepEqual(left, right, `${id}: logical host behavior differs`);
    equivalence.push({id, status: 'PASS', compared: ['ABI', 'authorization', 'token balances and allowances', 'host events', 'final FIFO/model state']});
  }
  const result = {
    status: 'PASS_LOCAL_EQUIVALENCE',
    evidenceClass: 'LOCAL_GANACHE_CORRECTNESS_AND_DIAGNOSTIC_GAS_ONLY',
    notMonadGas: true,
    compiler: {version: EXPECTED_SOLC, settings: SETTINGS, inputSha256: build.compilerInputSha256},
    sourceSha256: build.sourceSha256,
    runtimeSha256: build.runtimeSha256,
    abiAudit: build.abiAudit,
    configuration: CONFIG,
    rows,
    equivalence,
    durationMs: Date.now() - started
  };
  fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(path.join(outputDir, 'local.json'), json(result));
  fs.writeFileSync(path.join(outputDir, 'compiler-input.json'), json(build.compilerInput));
  await chain.disconnect();
  return result;
}

module.exports = {run};

if (require.main === module) run(process.env.BENCHMARK_OUT || path.join(__dirname, 'output')).then(result => {
  console.log(`LOCAL EQUIVALENCE PASS (${result.equivalence.length} fixtures)`);
}).catch(error => { console.error(error.stack || error); process.exit(1); });
