#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
started=$(date +%s)

npm --prefix "$root/benchmark" install --ignore-scripts --no-audit --no-fund
dependency_bytes=$(du -sb "$root/benchmark/node_modules" | awk '{print $1}')

BENCHMARK_DEPENDENCY_BYTES="$dependency_bytes" node "$root/benchmark/judge.cjs"

finished=$(date +%s)
echo "benchmark_wall_seconds=$((finished-started))"
echo "benchmark_dependency_bytes=$dependency_bytes"
