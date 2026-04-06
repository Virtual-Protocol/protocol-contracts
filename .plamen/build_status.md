# Build Status

## Task 1: Build Environment

### Configuration
- **Build System**: Hardhat only (no foundry.toml existed at project root)
- **foundry.toml**: Created minimal scaffold (src=contracts, out=out, libs=[node_modules,lib], solc 0.8.26, via_ir=true)
- **node_modules**: Present (yarn install not needed)
- **git submodules**: N/A (project uses npm/yarn packages)

### Compilation
- **Compiler**: Solc 0.8.26 (via Hardhat)
- **Build Result**: SUCCESS
- **Files compiled**: 209 Solidity files (forge --force run)
- **Forge build**: `Compiler run successful with warnings` (0 errors)

### Warnings Noted
1. **Function state mutability** warnings in mock contracts (AgentVeToken.sol, AgentVeTokenV2.sol, MockUniswapV2Router02.sol) — can be restricted to `pure`
2. **BondingV5.sol contract size**: 28310 bytes > EIP-170 limit (24576 bytes)
   - Covered in hardhat.config.js: `allowUnlimitedContractSize: true` for hardhat network
   - **TEST HEALTH WARNING**: BondingV5 cannot be deployed on mainnet as-is

### Metrics
- **COMPILE_WEIGHT**: light (20 in-scope .sol files, 126 total in contracts/)
- **COMPILER_VERSION**: 0.8.26
- **REPO_SHAPE**: normal_dev (303 commits via `git rev-list --count HEAD`)
- **MEDUSA_AVAILABLE**: false (command not found)
- **SLITHER**: UNAVAILABLE (MCP tool not available in environment)
- **HARDHAT_DEPENDENCY_COMPILER**: not detected

### Forge Build Output
```
Compiling 209 files with Solc 0.8.26
Compiler run successful with warnings:
[Multiple state mutability warnings in mock contracts — non-blocking]
[BondingV5 size warning: 28310 bytes > 24576 bytes EIP-170 limit]
```

## Task 2: Static Analysis Artifacts

- SLITHER: UNAVAILABLE — used grep fallback
- function_list.md: written
- modifiers.md: written
- event_definitions.md: written
- state_variables.md: written
- call_graph.md: written (manual, grep-based)
- external_interfaces.md: written
- static_analysis.md: written (grep-based detector results)

## Task 8: Slither Detectors

Ran via grep fallback. Key findings:
- **reentrancy-eth**: No issues in production contracts; multicall3 has intentional `.call{value}` usage
- **divide-before-multiply**: BondingV2/V3/V4 liquidity formula uses chained div-mul — flag for review
- **costly-loop**: Only in mock contracts (MockAgentToken), not production
- **calls-loop**: multicall3 only (intentional), not production bonding contracts
- **dead-code**: BondingV2._preLaunch() is a stub revert — intentional
- **unused-state**: FPairV2.Pool.lastUpdated field written but never read

## Task 9: Test Results

- bondingV5.js: **95 passing, 0 failing** (HEALTHY)
- bondingV5 drain+tax: 13 passing, 4 failing (cascade from BondingV2 stub)
- bondingV2.js: 6 passing, 21 failing (BondingV2._preLaunch stub)
- routerV2+factoryV2: 7 passing, 25 failing (BondingV2 cascade)
- **Total**: ~121 passing, ~50 failing
- **Root cause of all failures**: `BondingV2._preLaunch()` at line 264 → `revert("Not implemented")`
