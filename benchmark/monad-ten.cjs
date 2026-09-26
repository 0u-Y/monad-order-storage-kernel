'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ganache = require('ganache');
const {ethers} = require('ethers');
const {CONFIG, FIXED_BLOCK, EXPECTED_SOLC, SETTINGS, compile, hostArgs, json, safeLimit} = require('./lib.cjs');

const MARKET = CONFIG.marketId;
const RPC_URL = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const REQUEST_CAP = Math.min(Number(process.env.BENCHMARK_RPC_CAP || 100), 100);
const A = {
  base: '0x000000000000000000000000000000000000ba5e',
  quote: '0x000000000000000000000000000000000000a05d',
  host: '0x000000000000000000000000000000000000ca11',
  admin: '0x000000000000000000000000000000000000d101',
  taker: '0x000000000000000000000000000000000000d102',
  recovery: '0x000000000000000000000000000000000000d103'
};
const makers = Array.from({length: 4}, (_, i) => `0x${(0xd110 + i).toString(16).padStart(40, '0')}`);
const actors = [A.admin, A.taker, A.recovery, ...makers];
const coder = ethers.AbiCoder.defaultAbiCoder();
const word = value => ethers.toBeHex(value, 32);
const mapSlot = (types, values) => ethers.keccak256(coder.encode(types, values));
const stateSlot = ethers.keccak256(coder.encode(['bytes32', 'bytes32'], [ethers.id('monad-ac.order-storage.state.v1'), MARKET]));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

let callCount = 0;
const raw = [];

async function rpc(method, params, label) {
  if (++callCount > REQUEST_CAP) throw new Error(`RPC request cap exceeded: ${REQUEST_CAP}`);
  const request = {jsonrpc: '2.0', id: callCount, method, params};
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const http = await fetch(RPC_URL, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30000)
      });
      response = await http.json();
      if (http.ok && !response.error) break;
      if (attempt === 0 && (http.status === 429 || http.status >= 500)) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      break;
    } catch (error) {
      response = {error: {message: `transport: ${error.message}`}};
      if (attempt === 0) { await new Promise(resolve => setTimeout(resolve, 500)); continue; }
    }
  }
  raw.push({label, request, response});
  return response;
}

function packed64(values) {
  return word(values.reduce((acc, value, index) => acc + (BigInt(value) << (64n * BigInt(index))), 0n));
}

function hostState(kind) {
  const state = {[word(0)]: packed64(CONFIG.ticks.slice(0, 4)), [word(1)]: packed64(CONFIG.ticks.slice(4))};
  for (let i = 0; i < 8; i++) {
    state[word(2 + i)] = word(CONFIG.quoteRawPerLot[i]);
    state[mapSlot(['uint64', 'uint256'], [CONFIG.ticks[i], 10])] = word(i + 1);
  }
  state[word(12)] = word(1);
  if (kind === 'contiguous') state[stateSlot] = word(1);
  return state;
}

function tokenState(isQuote) {
  const state = {};
  for (const owner of isQuote ? [A.taker] : makers) {
    state[mapSlot(['address', 'uint256'], [owner, 0])] = word(10n ** 30n);
    const outer = mapSlot(['address', 'uint256'], [owner, 1]);
    state[mapSlot(['address', 'bytes32'], [A.host, outer])] = word(ethers.MaxUint256);
  }
  return state;
}

function initialOverrides(runtimes, kind) {
  const overrides = {};
  for (const actor of actors) overrides[actor] = {balance: '0x1000000000000000000000000'};
  overrides[A.base] = {code: runtimes.base, stateDiff: tokenState(false)};
  overrides[A.quote] = {code: runtimes.quote, stateDiff: tokenState(true)};
  overrides[A.host] = {code: runtimes[kind], stateDiff: hostState(kind)};
  return overrides;
}

function advance(overrides, trace) {
  const next = structuredClone(overrides);
  const ignored = new Set(actors.map(address => address.toLowerCase()));
  for (const [address, post] of Object.entries(trace.post || {})) {
    if (ignored.has(address.toLowerCase())) continue;
    next[address] ||= {};
    if (post.code) next[address].code = post.code;
    next[address].stateDiff ||= {};
    for (const slot of Object.keys(trace.pre?.[address]?.storage || {})) if (!(slot in (post.storage || {}))) next[address].stateDiff[slot] = ethers.ZeroHash;
    Object.assign(next[address].stateDiff, post.storage || {});
  }
  return next;
}

async function traceAdvance(data, overrides, from, label) {
  const response = await rpc('debug_traceCall', [
    {to: A.host, from, data, gas: '0x1c9c380'},
    FIXED_BLOCK.number,
    {tracer: 'prestateTracer', tracerConfig: {diffMode: true}, stateOverrides: overrides}
  ], label);
  if (!response.result?.post) throw new Error(`${label}: debug_traceCall unavailable: ${JSON.stringify(response.error || response)}`);
  return advance(overrides, response.result);
}

async function callAtLimit(data, overrides, from, limit, label) {
  return rpc('eth_call', [{to: A.host, from, data, gas: ethers.toBeHex(limit)}, FIXED_BLOCK.number, overrides], label);
}

async function measure(kind, intf, data, overrides, from, label, outputFunction) {
  const transaction = {to: A.host, from, data, gas: '0x1c9c380'};
  const call = await rpc('eth_call', [transaction, FIXED_BLOCK.number, overrides], `${label}:call`);
  if (!call.result) throw new Error(`${label}: eth_call failed: ${JSON.stringify(call.error)}`);
  const estimateResponse = await rpc('eth_estimateGas', [transaction, FIXED_BLOCK.number, overrides], `${label}:estimate`);
  if (!estimateResponse.result) throw new Error(`${label}: estimate failed: ${JSON.stringify(estimateResponse.error)}`);
  const estimate = BigInt(estimateResponse.result);
  const suggestedLimit = safeLimit(estimate);
  const limited = await callAtLimit(data, overrides, from, suggestedLimit, `${label}:suggested-limit`);
  assert.equal(typeof limited.result, 'string', `${label}: suggested limit failed`);
  return {
    kind,
    readOnlyEstimate: estimate,
    minimumSuccessLimit: 'N/A_NOT_SEARCHED',
    suggestedLimit,
    suggestedLimitValidatedAtSamePrestate: true,
    calldata: data,
    prestateSha256: sha(JSON.stringify(overrides)),
    rawPrestateLocation: 'rpc-raw.json (stateOverrides in the matching request)',
    decoded: [...intf.decodeFunctionResult(outputFunction, call.result)]
  };
}

async function runtimes(build) {
  const chain = ganache.provider({logging: {quiet: true}, chain: {hardfork: 'shanghai', allowUnlimitedContractSize: true}, wallet: {deterministic: true}});
  const provider = new ethers.BrowserProvider(chain);
  const signer = await provider.getSigner();
  async function runtime(artifact, args) {
    const contract = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(...args);
    await contract.waitForDeployment();
    return provider.getCode(await contract.getAddress());
  }
  const result = {
    base: await runtime(build.artifacts.token, [18]),
    quote: await runtime(build.artifacts.token, [6])
  };
  for (const kind of ['contiguous', 'linked']) result[kind] = await runtime(build.artifacts[kind], hostArgs(A.base, A.quote, A.recovery));
  await chain.disconnect();
  return result;
}

function refreshPlans(depth) {
  const plans = Array.from({length: 4}, () => []);
  for (let i = 0; i < depth; i++) {
    const makerIndex = i < 8 ? 0 : 1 + (i % 3);
    plans[makerIndex].push(CONFIG.ticks[i % 2]);
  }
  return plans;
}

async function refreshPrestate(runtimesByKind, kind, depth, intf) {
  let overrides = initialOverrides(runtimesByKind, kind);
  const plans = refreshPlans(depth);
  for (let i = 0; i < 4; i++) {
    if (!plans[i].length) continue;
    const data = intf.encodeFunctionData('refresh', [MARKET, [], plans[i], Array(plans[i].length).fill(2)]);
    overrides = await traceAdvance(data, overrides, makers[i], `${kind}/refresh-${depth}/setup-${i}`);
  }
  return overrides;
}

async function refreshRows(runtimesByKind, build) {
  const rows = [];
  for (const [depth, batch] of [[64, 2], [256, 1]]) for (const kind of ['contiguous', 'linked']) {
    const intf = new ethers.Interface(build.artifacts[kind].abi);
    const overrides = await refreshPrestate(runtimesByKind, kind, depth, intf);
    const handles = Array.from({length: batch}, (_, i) => 4294967297n + BigInt(i));
    const ticks = Array.from({length: batch}, (_, i) => CONFIG.ticks[(i + 1) % 2]);
    const data = intf.encodeFunctionData('refresh', [MARKET, handles, ticks, Array(batch).fill(2)]);
    const measured = await measure(kind, intf, data, overrides, makers[0], `${kind}/refresh-${depth}/${batch}+${batch}`, 'refresh');
    assert.equal(measured.decoded[0].length, batch);
    delete measured.decoded;
    rows.push({id: depth === 64 ? 'maker-refresh-2+2-active64' : 'maker-refresh-1+1-active256', activeDepth: depth, batch, ...measured});
  }
  return rows;
}

async function takerPrestate(runtimesByKind, kind, intf) {
  let overrides = initialOverrides(runtimesByKind, kind);
  const plans = Array.from({length: 4}, () => []);
  for (let i = 0; i < 17; i++) plans[i % 4].push(101);
  for (let i = 0; i < 16; i++) plans[(i + 1) % 4].push(102);
  for (let i = 0; i < 4; i++) {
    const data = intf.encodeFunctionData('refresh', [MARKET, [], plans[i], Array(plans[i].length).fill(2)]);
    overrides = await traceAdvance(data, overrides, makers[i], `${kind}/taker/setup-${i}`);
  }
  return overrides;
}

async function takerRows(runtimesByKind, build) {
  const rows = [];
  for (const kind of ['contiguous', 'linked']) {
    const intf = new ethers.Interface(build.artifacts[kind].abi);
    const overrides = await takerPrestate(runtimesByKind, kind, intf);
    for (const fillCount of [1, 5, 32]) {
      const lots = fillCount * 2;
      const low = Math.min(fillCount, 17);
      const high = fillCount - low;
      const quote = BigInt(low * 2) * 10000n + BigInt(high * 2) * 10200n;
      const data = intf.encodeFunctionData('take', [MARKET, lots, fillCount, quote, lots, FIXED_BLOCK.timestamp + 3600]);
      const measured = await measure(kind, intf, data, overrides, A.taker, `${kind}/taker-${fillCount}`, 'take');
      const fills = measured.decoded[0];
      assert.equal(fills.length, fillCount);
      for (let i = 1; i < fills.length; i++) assert.ok(fills[i - 1].priceTick <= fills[i].priceTick, 'price priority');
      delete measured.decoded;
      rows.push({id: `taker-${fillCount}-fill-active33`, activeDepth: 33, fillCount, ...measured});
    }
  }
  return rows;
}

async function staleCounterexample(runtimesByKind, build) {
  const kind = 'contiguous';
  const intf = new ethers.Interface(build.artifacts[kind].abi);
  let quoteState = initialOverrides(runtimesByKind, kind);
  quoteState = await traceAdvance(intf.encodeFunctionData('refresh', [MARKET, [], [101], [10]]), quoteState, makers[0], 'stale/quote-setup');
  const data = intf.encodeFunctionData('take', [MARKET, 10, 5, 102000, 10, FIXED_BLOCK.timestamp + 3600]);
  const quoted = await measure(kind, intf, data, quoteState, A.taker, 'stale/quoted', 'take');
  delete quoted.decoded;
  const inclusionState = await traceAdvance(intf.encodeFunctionData('refresh', [MARKET, [4294967297n], [101, 101, 101, 101, 101], [2, 2, 2, 2, 2]]), quoteState, makers[0], 'stale/mutation');
  const oldLimit = await callAtLimit(data, inclusionState, A.taker, quoted.suggestedLimit, 'stale/old-limit');
  const estimateResponse = await rpc('eth_estimateGas', [{to: A.host, from: A.taker, data, gas: '0x1c9c380'}, FIXED_BLOCK.number, inclusionState], 'stale/new-estimate');
  if (!estimateResponse.result) throw new Error(`stale new estimate failed: ${JSON.stringify(estimateResponse.error)}`);
  return {
    id: 'stale-preflight-split-head',
    kind,
    calldata: data,
    quotedPrestateSha256: quoted.prestateSha256,
    inclusionPrestateSha256: sha(JSON.stringify(inclusionState)),
    quotedEstimate: quoted.readOnlyEstimate,
    quotedSuggestedLimit: quoted.suggestedLimit,
    oldLimitSucceededAfterBookChange: Boolean(oldLimit.result),
    oldLimitError: oldLimit.error?.message || null,
    changedStateEstimate: BigInt(estimateResponse.result),
    stateChanged: quoted.prestateSha256 !== sha(JSON.stringify(inclusionState))
  };
}

function comparisons(rows) {
  return [...new Set(rows.map(row => row.id))].map(id => {
    const contiguous = rows.find(row => row.id === id && row.kind === 'contiguous');
    const linked = rows.find(row => row.id === id && row.kind === 'linked');
    assert.ok(contiguous && linked);
    const delta = contiguous.readOnlyEstimate - linked.readOnlyEstimate;
    const percent = Number(delta * 10000n / linked.readOnlyEstimate) / 100;
    return {
      id,
      equivalence: 'PASS_LOCAL_ASSERTIONS',
      contiguousEstimate: contiguous.readOnlyEstimate,
      linkedEstimate: linked.readOnlyEstimate,
      contiguousVsLinkedPercent: percent,
      result: delta < 0n ? 'CONTIGUOUS_LOWER' : delta > 0n ? 'CONTIGUOUS_HIGHER' : 'EQUAL',
      contiguousSuggestedLimit: contiguous.suggestedLimit,
      linkedSuggestedLimit: linked.suggestedLimit,
      suggestedLimitDelta: contiguous.suggestedLimit - linked.suggestedLimit,
      actualSubmittedLimit: 'N/A_READ_ONLY',
      receiptGasUsed: 'N/A_READ_ONLY',
      actualCharge: 'N/A_READ_ONLY'
    };
  });
}

async function run(outputDir) {
  const started = Date.now();
  const build = compile();
  const chainId = await rpc('eth_chainId', [], 'chain-id');
  assert.equal(Number(BigInt(chainId.result)), FIXED_BLOCK.chainId);
  const block = await rpc('eth_getBlockByNumber', [FIXED_BLOCK.number, false], 'fixed-block');
  assert.equal(block.result?.hash, FIXED_BLOCK.hash, 'historical block unavailable or changed');
  assert.equal(Number(BigInt(block.result.timestamp)), FIXED_BLOCK.timestamp);
  const runtime = await runtimes(build);
  const rows = [...await refreshRows(runtime, build), ...await takerRows(runtime, build)];
  const stale = await staleCounterexample(runtime, build);
  const result = {
    status: 'PASS_READ_ONLY_MONAD_TEN',
    evidenceClass: 'CHAIN_143_FIXED_BLOCK_ETH_CALL_AND_ESTIMATE_WITH_STATE_OVERRIDE',
    chainId: FIXED_BLOCK.chainId,
    block: FIXED_BLOCK,
    compiler: {version: EXPECTED_SOLC, settings: SETTINGS, inputSha256: build.compilerInputSha256},
    sourceSha256: build.sourceSha256,
    runtimeSha256: build.runtimeSha256,
    fixture: CONFIG,
    rows,
    comparisons: comparisons(rows),
    staleCounterexample: stale,
    rpcAccounting: {requests: callCount, cap: REQUEST_CAP, transactionsSent: 0},
    metricDefinitions: {
      readOnlyEstimate: 'eth_estimateGas at the pinned state; not receipt gas',
      minimumSuccessLimit: 'N/A; binary minimum was not searched',
      suggestedLimit: 'ceil(readOnlyEstimate * 1.15 / 1000) * 1000, validated only at the identical prestate',
      submittedLimit: 'N/A; no transaction was submitted',
      receiptFee: 'N/A; no receipt exists'
    },
    notClaimed: ['page locality as sole cause', 'Kuru advantage', 'TPS', 'receipt gas', 'actual fee saving', 'universal safe gas limit'],
    durationMs: Date.now() - started
  };
  fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(path.join(outputDir, 'monad-ten.json'), json(result));
  fs.writeFileSync(path.join(outputDir, 'rpc-raw.json'), json({rpcUrl: 'REDACTED_PUBLIC_ENDPOINT', calls: raw}));
  return result;
}

module.exports = {run};

if (require.main === module) run(process.env.BENCHMARK_OUT || path.join(__dirname, 'output')).then(result => {
  console.log(`MONAD TEN READ-ONLY PASS (${result.rpcAccounting.requests} RPC calls)`);
}).catch(error => { console.error(error.stack || error); process.exit(1); });
