#!/usr/bin/env bash
set -euo pipefail

kit_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
expected_package="4fa0bd18bc5846313351d6fb4d79d6317ec4b7309180b86afee4916ec1b5012b"
expected_kernel="cce2e055fb84169e5d996c87edd99f116b3af60951f2ee48fd10aa74b630553e"

command -v node >/dev/null
command -v npm >/dev/null
command -v sha256sum >/dev/null
command -v tar >/dev/null

actual_package="$(sha256sum "$kit_dir/order-storage-preview.tgz" | awk '{print $1}')"
actual_kernel="$(tar -xOf "$kit_dir/order-storage-preview.tgz" package/contracts/OrderStorageKernel.sol | sha256sum | awk '{print $1}')"
[[ "$actual_package" == "$expected_package" ]] || { echo "package hash mismatch: $actual_package" >&2; exit 3; }
[[ "$actual_kernel" == "$expected_kernel" ]] || { echo "kernel hash mismatch: $actual_kernel" >&2; exit 4; }

(
  cd "$kit_dir/consumer"
  npm install --ignore-scripts --no-audit --no-fund
  npm run demo
)

echo "INTEGRATOR KIT PASS"
echo "package_sha256=$actual_package"
echo "kernel_sha256=$actual_kernel"
