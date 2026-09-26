'use strict';

function orderRef(hostAddress, marketId, handle) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(hostAddress)) throw new TypeError('hostAddress must be 20-byte hex');
  if (!/^0x[0-9a-fA-F]{64}$/.test(marketId)) throw new TypeError('marketId must be bytes32 hex');
  const value = BigInt(handle);
  if (value < 0n || value >= (1n << 96n)) throw new RangeError('handle must fit uint96');
  return Object.freeze({hostAddress, marketId, handle: value});
}

function orderRefKey(reference) {
  const ref = orderRef(reference.hostAddress, reference.marketId, reference.handle);
  return `${ref.hostAddress.toLowerCase()}:${ref.marketId.toLowerCase()}:${ref.handle}`;
}

module.exports = {orderRef, orderRefKey};
