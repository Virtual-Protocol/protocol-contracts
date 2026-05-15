# $FLOW Audit Scope (dPNM model)

## In scope

| Path | Purpose | Approx LOC | Approx nSLOC |
|------|---------|------------|--------------|
| `contracts/flow/FlowToken.sol` | ERC20 with USDT-backed mint/burn, MINTER_ROLE bound to FlowProtocol | ~250 | ~140 |
| `contracts/flow/FlowProtocol.sol` | buy / sell / activate / extendTree / income-limit logic; pool custody | ~900 | ~520 |
| `contracts/flow/PhenomenalTree.sol` | 3-branch × 10-level placement, spillover, ancestor walk | ~450 | ~260 |
| `contracts/flow/GWTToken.sol` (a.k.a. `FlowGrowToken.sol`) | Compensating token, 1:1 mint vs fees, burn-for-IL | ~180 | ~110 |
| Shared interfaces / errors / events | as separate `.sol` if extracted | ~120 | ~70 |

**Total estimated:** ~1.9k LOC, ~1.1k nSLOC.

`nSLOC` excludes blank lines, comments, single-brace lines, and pragma/import lines (Solidity Metrics conventions).

## Solidity / toolchain

- `pragma solidity ^0.8.24`
- OpenZeppelin Contracts v5.x (locked exact version in `package.json`)
- Hardhat + Foundry; tests in both
- Slither, Mythril, Echidna, Halmos in CI

## Out of scope

- Deploy scripts under `scripts/` and `script/`
- Mocks under `contracts/flow/mocks/` (test-only)
- Frontend / off-chain backend
- **GWT staking (future)** — design not finalised
- Non-flow contracts in this repo (AgentReward, launchpadv2, virtualPersona, etc.)
- Multisig / Gnosis Safe internals
- Bridges / cross-chain modules
- BSC node software, RPC providers

## Network targets

- Primary: BSC mainnet (chainId 56), USDT = `0x55d398326f99059fF775485246999027B3197955` (BEP20 USDT, 18 decimals).
- Test: BSC testnet (chainId 97), with mock USDT.

## Known issues from internal review

1. **Spillover algorithm cost** — current draft scans subtree BFS; needs O(1) pointer. Tracked under D-02 / A-14.
2. **Push-payment payouts** — `_payTree` synchronous; **must convert to pull**. Tracked under D-01 / A-10.
3. **`income_limit_factor` mutability** — currently owner-mutable; needs timelock + bound + per-buy snapshot. T-01 / A-12.
4. **`activated` re-entry** — `activate` not yet `nonReentrant`. A-05.
5. **No `MAX_BUY` cap** — overflow risk via giant buy. A-02.
6. **Missing events** — IL burn, daily refill, parameter changes. R-01..R-04.
7. **Owner `rescueERC20`** — must reject USDT. E-02.
8. **Self-referral / cycles** — not yet checked in `activate`. A-04.

## Roles / privileges

| Role | Holder (recommended) | Powers |
|------|----------------------|--------|
| `OWNER` | Gnosis Safe 3/5 + 48h Timelock | `pause`, `unpause`, `setIncomeLimitFactor` (bounded), `setMinBuy` (bounded), `rescueERC20` (≠ USDT) |
| `MINTER_ROLE` (FlowToken) | `FlowProtocol` (immutable) | mint $FLOW only via buy() |
| `MINTER_ROLE` (GWTToken) | `FlowProtocol` (immutable) | mint GWT 1:1 with fees |
| `UPGRADER_ROLE` | none (recommended non-upgradeable) — if UUPS, multisig + timelock |

## Deployment plan

1. Audit + fixes pass on BSC testnet for ≥ 14 days with bug bounty open.
2. Deploy to BSC mainnet with owner = Timelock(Gnosis 3/5).
3. Set `MINTER_ROLE` on both tokens to FlowProtocol; renounce admin role.
4. Initialise tree root.
5. Set `paused = true` initially; whitelist of beta users for first 7 days.
6. Public unpause after monitoring window.

## Bug bounty estimate

Pre-launch (Immunefi / Hats):
- **Critical** (pool drain, mass income inflation, supply mint): **$250k–$500k**
- **High** (single-user IL bypass, tree DoS): **$50k**
- **Medium** (event/accounting issues): **$10k**
- **Low / informational:** **$1k**

Total recommended bounty pool: **$500k for first 90 days**; reduce to $200k steady-state.

## Audit cost estimate

| Vendor | Mode | Range (USD) | Calendar |
|--------|------|-------------|----------|
| **Spearbit** (lead + 2 senior) | private engagement, ~3 weeks | **$120k–$180k** | 4–6 weeks scheduling lead time |
| **Trail of Bits** | private | $150k–$220k | 6–8 weeks lead |
| **Code4rena** | competitive, 7-day contest | **$80k–$120k** prize pool + $20k judge | 3–4 weeks lead |
| **Sherlock** | competitive + watson-judged | $60k–$100k | 2–3 weeks |
| **OpenZeppelin** | private | $180k–$260k | 8–10 weeks |
| **Cantina** | competitive (Spearbit-run) | $80k–$140k | 3–4 weeks |

**Recommended path:** Spearbit private (gold-standard report) **+** Code4rena public contest (broad coverage) for total ≈ **$200k–$280k** and 6–8 weeks calendar. Bug bounty stays open continuously after.

## Assumptions made by auditors

- USDT on BSC behaves as standard 18-decimal ERC20 with no fee-on-transfer and no transfer hook (true today, document the assumption).
- BSC block time ~3s, miner timestamp drift ≤ 900s.
- No L2 / cross-chain reuse of the protocol contracts.
- Owner key custody is a Gnosis Safe with vetted signers.

## Deliverables expected from each audit pass

- Issue list with severity, recommendation, and PoC for high+ findings.
- Differential test suite covering each fixed finding.
- Final report after fixes applied; clean re-test sign-off.
