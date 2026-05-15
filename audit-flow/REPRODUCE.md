# $FLOW Audit Reproduction Guide

Step-by-step environment setup and end-to-end runbook for an external auditor. Target audience: senior solidity reviewer with no prior context on the codebase.

## 0. Prerequisites

- Node.js 20.x, npm or pnpm
- Foundry (`forge`, `cast`, `anvil`) — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- Python 3.11 + `pipx` for Slither / Mythril
- Echidna 2.2+ (Docker image: `trailofbits/echidna`)
- Halmos: `pip install halmos`
- A funded BSC testnet wallet (faucet: https://testnet.bnbchain.org/faucet-smart)
- MetaMask configured for BSC testnet (chainId 97, RPC https://data-seed-prebsc-1-s1.binance.org:8545/)

## 1. Clone & install

```bash
git clone git@github.com:FranchiseFactoryStudio/agentflow-contracts.git
cd agentflow-contracts
git checkout audit/flow
npm ci
forge install
```

## 2. Compile

```bash
npx hardhat compile
forge build --sizes
```

Expected: zero warnings, all contracts < 24576 bytes.

## 3. Static analysis

```bash
# Slither
pipx install slither-analyzer
slither contracts/flow/ --filter-paths "node_modules|test|mocks" --exclude-low

# Mythril (per-contract)
myth analyze contracts/flow/FlowProtocol.sol --solv 0.8.24 --execution-timeout 600
```

## 4. Unit + invariant tests

```bash
# Hardhat unit tests
npx hardhat test test/flow/unit/**/*.test.ts

# Foundry unit + fuzz
forge test --match-path "test/flow/**" -vvv

# Foundry stateful invariants
forge test --match-path "test/flow/invariants/**" --invariant-runs 1000 --invariant-depth 100 -vv
```

## 5. Coverage

```bash
forge coverage --match-path "test/flow/**" --report lcov --report summary
genhtml lcov.info -o coverage/flow
open coverage/flow/index.html
```

Expected: ≥ 95% statement, ≥ 90% branch on `contracts/flow/*`.

## 6. Echidna

```bash
docker run --rm -v "$PWD":/src trailofbits/echidna echidna-test \
  /src/test/flow/echidna/FlowProtocolEchidna.sol \
  --config /src/test/flow/echidna/echidna.yaml --test-limit 200000
```

## 7. Halmos symbolic

```bash
halmos --contract FlowProtocol --function _consumeDaily
halmos --contract FlowProtocol --function _priceAfter
```

## 8. Local fork test

```bash
# Fork BSC mainnet at a recent block
anvil --fork-url https://bsc-dataseed1.binance.org --chain-id 56 --port 8545 &
forge script script/flow/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast --unlocked
```

## 9. Deploy on BSC testnet

```bash
cp .env.example .env
# Fill: PRIVATE_KEY, BSCSCAN_API_KEY, BSC_TESTNET_RPC

forge script script/flow/DeployTestnet.s.sol \
  --rpc-url $BSC_TESTNET_RPC \
  --broadcast --verify --etherscan-api-key $BSCSCAN_API_KEY
```

Outputs `deployment-bsc-testnet.json` with addresses for `FlowToken`, `FlowProtocol`, `PhenomenalTree`, `GWTToken`, `MockUSDT`.

## 10. End-to-end via MetaMask + Etherscan

Add the tokens to MetaMask using addresses from step 9.

### 10.1 Activate as root
- On Etherscan testnet UI, open `FlowProtocol`.
- Call `activate(referrer = 0x0)` from `OWNER` (root case allowed only by owner).
- Confirm `tree.activated[OWNER] == true` via `tree.viewNode(OWNER)`.

### 10.2 Activate child user
- From a fresh wallet `U1`, faucet BNB and mint MockUSDT (`MockUSDT.mint(U1, 1000e18)`).
- Approve `FlowProtocol` for USDT.
- Call `activate(referrer = OWNER)`.
- Verify `parent(U1) == OWNER`, `branches(OWNER).length == 1`.

### 10.3 Buy $FLOW
- `U1` calls `FlowProtocol.buy(amountUsdt = 100e18)`.
- Verify:
  - `balanceOf(U1) > 0`
  - `incomeLimit[U1] == 100e18 * income_limit_factor`
  - `pool USDT increased by ~100e18 (minus fee)`
  - GWT minted to U1 equal to fee

### 10.4 Daily limit check
- `U1` calls `sell(small)` 5× consecutively.
- After cumulative `min(50e18, pool*0.001)` reached, next call MUST revert with `DailyCapExceeded`.
- Time-warp +24h on testnet by waiting; re-test.

### 10.5 Sell + IL burn
- `U1` `sell(amount)` so that `value_out > IL[U1]/2`.
- Verify `IL[U1]_after == IL[U1]_before - value_out` and `B[U1]` decreased and `pool` decreased.

### 10.6 ExtendTree + tree payout (pull-style)
- `U1` calls `extendTree(value)`.
- Verify `activeUntil[U1] += duration`, ancestors' `pendingReward` increased.
- `OWNER` calls `claim()`; verify USDT/$FLOW received.

### 10.7 Buy IL with GWT
- `U1` calls `buyIncomeLimitWithGwt(amount)` with `amount <= ILE[U1]/10 - ILG[U1]`.
- Verify `IL[U1]` and `ILG[U1]` increased; GWT burned.
- Boundary: attempt at 10.01% should revert with `GwtIlCapExceeded`.

### 10.8 Negative tests on testnet
- Self-referral: `U2.activate(referrer = U2)` → revert.
- Re-activation: `U1.activate(referrer = OWNER)` after already active → revert.
- Inactive referrer: `U3.activate(referrer = ghost)` where ghost not active → revert.

## 11. Reporting

Auditors should file findings as PRs against `audit/flow` branch with:
- File: `audit-flow/findings/F-NN-<short-name>.md`
- Severity, location, PoC test, recommended fix.
- A failing Foundry test that demonstrates the issue.

## 12. Replay attack scenarios

For each scenario in `ATTACK_SCENARIOS.md`, a corresponding test exists at `test/flow/attacks/A-NN-*.t.sol`. Run all:

```bash
forge test --match-path "test/flow/attacks/**" -vv
```

Expected: every test currently passes (or is skipped pending fix). After audit fixes, all should pass.
