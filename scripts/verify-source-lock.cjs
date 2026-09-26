'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const expectedPackage = '4fa0bd18bc5846313351d6fb4d79d6317ec4b7309180b86afee4916ec1b5012b';
const expectedKernel = 'cce2e055fb84169e5d996c87edd99f116b3af60951f2ee48fd10aa74b630553e';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

const archive = fs.readFileSync(path.join(root, 'order-storage-preview.tgz'));
assert.equal(digest(archive), expectedPackage, 'frozen package hash changed');

const visibleKernel = fs.readFileSync(path.join(root, 'contracts', 'OrderStorageKernel.sol'));
const packedKernel = execFileSync('tar', [
  '-xOf',
  path.join(root, 'order-storage-preview.tgz'),
  'package/contracts/OrderStorageKernel.sol'
]);

assert.equal(digest(visibleKernel), expectedKernel, 'visible kernel hash changed');
assert.equal(digest(packedKernel), expectedKernel, 'packed kernel hash changed');
assert.deepEqual(visibleKernel, packedKernel, 'visible and frozen kernels differ');

console.log('SOURCE DISTRIBUTION PASS');
console.log(`package_sha256=${expectedPackage}`);
console.log(`kernel_sha256=${expectedKernel}`);
