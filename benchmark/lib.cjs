'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const solc = require('solc');
const {ethers} = require('ethers');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_SOLC = '0.8.30+commit.73712a01.Emscripten.clang';
const SETTINGS = {
  optimizer: {enabled: true, runs: 200},
  viaIR: true,
  evmVersion: 'shanghai',
  outputSelection: {'*': {'*': ['abi', 'storageLayout', 'evm.bytecode.object', 'evm.deployedBytecode.object']}}
};
const CONFIG = {
  marketId: ethers.id('MULTI-PRICE-INVENTORY-V1'),
  baseDecimals: 18,
  quoteDecimals: 6,
  baseRawPerLot: 10n ** 16n,
  ticks: [101n, 102n, 103n, 104n, 105n, 106n, 107n, 108n],
  quoteRawPerLot: [10000n, 10200n, 10400n, 10600n, 10800n, 11000n, 11200n, 11400n],
  minimumOrderLots: 2n,
  minimumResidualLots: 2n
};
const FIXED_BLOCK = {
  chainId: 143,
  number: '0x6592850',
  hash: '0xa582f09dc794ea690aeac2a76ed76af5d1e6fad9e116e0414376fafbf0c25360',
  timestamp: 1789920318
};
const PACKAGE_SHA256 = '4fa0bd18bc5846313351d6fb4d79d6317ec4b7309180b86afee4916ec1b5012b';
const KERNEL_SHA256 = 'cce2e055fb84169e5d996c87edd99f116b3af60951f2ee48fd10aa74b630553e';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const safeLimit = estimate => ((BigInt(estimate) * 115n + 99n) / 100n + 999n) / 1000n * 1000n;
const hostArgs = (base, quote, recovery) => [
  base, quote, recovery, CONFIG.marketId, CONFIG.baseRawPerLot, CONFIG.ticks,
  CONFIG.quoteRawPerLot, CONFIG.minimumOrderLots, CONFIG.minimumResidualLots,
  CONFIG.baseDecimals, CONFIG.quoteDecimals
];

function compile() {
  assert.equal(solc.version(), EXPECTED_SOLC, 'compiler version drift');
  const files = {
    'contracts/MultiPriceInventoryBase.sol': path.join(ROOT, 'examples/multi-price/contracts/MultiPriceInventoryBase.sol'),
    'contracts/ContiguousMultiPriceInventory.sol': path.join(ROOT, 'examples/multi-price/contracts/ContiguousMultiPriceInventory.sol'),
    'contracts/LinkedMultiPriceInventory.sol': path.join(ROOT, 'evidence/baselines/LinkedMultiPriceInventory.sol'),
    'contracts/StrictMockERC20.sol': path.join(ROOT, 'examples/multi-price/contracts/StrictMockERC20.sol'),
    '@monad-ac/order-storage-preview/contracts/OrderStorageKernel.sol': path.join(__dirname, 'node_modules/@monad-ac/order-storage-preview/contracts/OrderStorageKernel.sol')
  };
  const sources = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, {content: fs.readFileSync(file, 'utf8')}]))
  const input = {language: 'Solidity', sources, settings: SETTINGS};
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter(item => item.severity === 'error');
  if (errors.length) throw new Error(JSON.stringify(errors, null, 2));
  const artifact = (file, name) => output.contracts[file][name];
  const artifacts = {
    contiguous: artifact('contracts/ContiguousMultiPriceInventory.sol', 'ContiguousMultiPriceInventory'),
    linked: artifact('contracts/LinkedMultiPriceInventory.sol', 'LinkedMultiPriceInventory'),
    token: artifact('contracts/StrictMockERC20.sol', 'StrictMockERC20')
  };
  const requiredFunctions = ['allocator(bytes32)', 'cancel(bytes32,uint96)', 'level(bytes32,uint64)', 'order(bytes32,uint96)', 'post(bytes32,uint64,uint96)', 'refresh(bytes32,uint96[],uint64[],uint96[])', 'take(bytes32,uint96,uint32,uint256,uint96,uint256)'];
  const requiredEvents = ['OrderCancelled(bytes32,uint64,uint96,address,uint96,uint256)', 'OrderPosted(bytes32,uint64,uint96,address,uint96,uint256,uint256)', 'OrderRefreshed(bytes32,address,uint96,uint96,uint256,uint256)', 'TradeSettled(bytes32,uint64,uint96,address,address,uint96,uint256,uint256,uint96)'];
  for (const kind of ['contiguous', 'linked']) {
    const intf = new ethers.Interface(artifacts[kind].abi);
    for (const signature of requiredFunctions) assert.ok(intf.getFunction(signature), `${kind} missing ${signature}`);
    for (const signature of requiredEvents) assert.ok(intf.getEvent(signature), `${kind} missing ${signature}`);
  }
  const contiguousInterface = new ethers.Interface(artifacts.contiguous.abi);
  const linkedInterface = new ethers.Interface(artifacts.linked.abi);
  for (const signature of requiredFunctions) {
    assert.equal(contiguousInterface.getFunction(signature).selector, linkedInterface.getFunction(signature).selector, `wire selector differs: ${signature}`);
  }
  for (const signature of requiredEvents) {
    assert.equal(contiguousInterface.getEvent(signature).topicHash, linkedInterface.getEvent(signature).topicHash, `wire event topic differs: ${signature}`);
  }
  const packageBytes = fs.readFileSync(path.join(ROOT, 'order-storage-preview.tgz'));
  const kernelBytes = fs.readFileSync(path.join(ROOT, 'contracts/OrderStorageKernel.sol'));
  assert.equal(digest(packageBytes), PACKAGE_SHA256, 'frozen package changed');
  assert.equal(digest(kernelBytes), KERNEL_SHA256, 'frozen kernel changed');
  return {
    artifacts,
    compilerInput: input,
    compilerInputSha256: digest(JSON.stringify(input)),
    sourceSha256: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, digest(source.content)])),
    abiAudit: {
      status: 'PASS_WIRE_SELECTORS_AND_TOPICS',
      requiredFunctions,
      requiredEvents,
      note: 'KernelOrderConsumed ABI argument labels differ in the historical linked source; its event topic and positional values match.'
    },
    runtimeSha256: Object.fromEntries(['contiguous', 'linked'].map(kind => [kind, digest(Buffer.from(artifacts[kind].evm.deployedBytecode.object, 'hex'))]))
  };
}

module.exports = {
  ROOT, EXPECTED_SOLC, SETTINGS, CONFIG, FIXED_BLOCK, PACKAGE_SHA256, KERNEL_SHA256,
  digest, json, safeLimit, hostArgs, compile
};
