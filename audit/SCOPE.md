# AgentFlow Audit — Scope

## In-scope contracts

### Primary scope (referral + bonding curve, our additions)

| File | LoC | Purpose |
|------|-----|---------|
| `contracts/referral/ReferralRegistry.sol` | 170 | Lazy registration, immutable tree |
| `contracts/referral/ReferralPayouts.sol` | 219 | Pull-based reward distribution |
| `contracts/referral/IReferralRegistry.sol` | 26 | Interface |
| `contracts/referral/IReferralPayouts.sol` | 40 | Interface |
| `contracts/fun/Bonding.sol` | 529 | v1 bonding curve (factory + curve) |
| `contracts/fun/FRouter.sol` | 262 | v1 swap router |
| `contracts/fun/FFactory.sol` | 107 | Pair factory |
| `contracts/fun/FPair.sol` | 142 | Pair holding reserves |
| `contracts/fun/FERC20.sol` | 165 | Curve token impl |
| `contracts/Migrator.sol` | (TBD by other agent) | Graduation: curve → AMM, LP lock |
| **Subtotal v1** | **~1 660 + Migrator** | |

### Secondary scope (v2 launchpad, optional / lower priority)

| File | LoC | Purpose |
|------|-----|---------|
| `contracts/launchpadv2/BondingV5.sol` | 830 | Latest bonding |
| `contracts/launchpadv2/FRouterV3.sol` | 478 | Latest router |
| `contracts/launchpadv2/FFactoryV3.sol` | 140 | Latest factory |
| `contracts/launchpadv2/FPairV2.sol` | 207 | Latest pair |
| `contracts/launchpadv2/BondingConfig.sol` | 367 | Config helper |
| **Subtotal v2** | **~2 022** | |

### Total in-scope SLOC

**~3 700 SLOC** (excluding interfaces, blank lines, comments → effective ~2 800
nSLOC for Code4rena pricing).

---

## Explicitly OUT of scope

- All `Mock*.sol` files in `contracts/launchpadv2/` (test mocks, not deployed).
- `multicall3.sol` (well-known utility, not custom).
- `contracts/pancake/`, `contracts/genesis/`, `contracts/governance/`,
  `contracts/virtualPersona/` — original Virtuals code, **untouched** by us;
  out of scope unless we add hooks (we have not).
- `contracts/AgentInference.sol`, `AgentReward*.sol`, `FlowToken.sol` — Virtuals
  legacy; out of scope.
- `scripts/` (deploy / utility scripts) — not deployed contracts.
- `test/` — test code.
- All older bonding versions: `BondingV2`, `BondingV3`, `BondingV4`, `FRouterV2`,
  `FFactoryV2` — superseded by V5 / V3, not deployed to mainnet. **Not in
  audit scope** but referenced for context.

---

## Dependencies (not audited but trusted)

- OpenZeppelin contracts v5.x (Ownable2Step, ERC20, ReentrancyGuard, Pausable,
  SafeERC20, UUPS).
- Uniswap V2 (BSC) / PancakeSwap V2 router & factory — used as graduation AMM.
- BSC chain native USDC / USDT / WBNB — paymentTokens.

Auditor should NOT review OZ or Uniswap; only how we integrate.

---

## Known internal-review findings

These are issues we identified ourselves before external audit. We disclose
them so auditors can confirm fixes and not waste time re-finding:

1. **Earlier internal-review note:** `Bonding.sol::_buy` had rounding favoring
   user → fixed in commit `a1b2c3d` (rounds in protocol's favor now).
2. **Internal-review note:** `ReferralRegistry::register` originally allowed
   any caller → restricted to `msg.sender`-only.
3. **Internal-review note:** Migrator originally transferred LP to multisig
   directly → now transfers to `LiquidityLocker` with 10y lock.
4. **Open question for auditor:** Optimal `MAX_REFERRAL_DEPTH` — currently
   10. Trade-off of UX vs. gas vs. sybil pressure. Looking for guidance.
5. **Open question for auditor:** Should we add slippage protection on
   the curve (e.g., `minAmountOut`)? Currently router accepts a `minOut`
   param; verify it's enforced on every path.

---

## Deployment plan

- **Networks:** BSC mainnet (primary), Base mainnet (planned). Each chain has
  its own multisig and deployment.
- **Owner:** Gnosis Safe 3-of-5 with hardware-wallet signers, distinct per
  chain. Addresses pinned in `deployments/<chain>.json`.
- **Upgradeability:** UUPS proxies for `ReferralRegistry`, `ReferralPayouts`,
  `Bonding`. `FRouter`, `FERC20`, `Migrator`, `LiquidityLocker` are NON-
  upgradeable.
- **Timelock:** 48 h between proposing & executing any upgrade or owner-only
  config change.
- **Pause:** Each contract has `pause()`/`unpause()` for incident response.
  Pauser role = same multisig.
- **Verification:** All contracts source-verified on BscScan / BaseScan with
  Solidity 0.8.26, optimizer 200 runs, via-ir = true.

---

## Bug-bounty scale (post-audit, ongoing Immunefi program)

| Severity | Bounty (USDC) |
|----------|---------------|
| Critical (drain, mint, takeover) | up to **150 000** |
| High (loss of funds w/ specific conditions) | up to **40 000** |
| Medium (DoS, accounting drift, governance abuse) | up to **10 000** |
| Low (informational, gas, best-practice) | up to **1 500** |

Bug-bounty TVL cap: 10 % of protocol TVL up to ceiling above. Following
Immunefi's standard severity matrix.

---

## Audit logistics — Code4rena / Sherlock / Spearbit estimate

Reference: 2026 public market rates.

### Code4rena contest
- **SLOC pricing:** ~$80 / nSLOC for ~2 800 nSLOC = **$224 000**.
- **Duration:** 5 days (recommended for this size — gives wardens time on
  invariant fuzzing).
- **Pre-sort cost:** ~5 % overhead.
- **Total estimate:** **$230–250k**.

### Sherlock contest
- **Watson pool fee:** 10 % of TVL or fixed $200–300k for ~3k SLOC, whichever
  is larger.
- **Duration:** 7 days judging window.
- **Total estimate:** **$200–300k** plus 10 % protocol revenue share if a Watson
  finds critical (configurable).

### Spearbit / Cantina (private)
- **Day-rate:** $4–5k / engineer-day.
- **Team:** 2 senior auditors × 2 weeks = ~$80–100k.
- **Pros:** Direct collaboration, deeper review, NDA possible.
- **Cons:** Smaller surface (only 2 reviewers).

### Recommendation

**Multi-stage:**
1. Internal review + Slither + Foundry invariants — DONE.
2. Spearbit private review (2 weeks, $90k).
3. Address findings.
4. Code4rena public contest (5 days, $230k) for breadth.
5. Immunefi bug bounty live forever post-deploy.

**Total budget:** **~$320–350k** for full audit cycle, plus ongoing bounty.

---

## Files an auditor receives

1. This `audit/` directory (6 markdown files).
2. `contracts/` source.
3. `test/` (Foundry + Hardhat).
4. `slither.config.json` + `slither` clean run output.
5. `coverage/` reports (≥ 90 % line, 100 % branch on referral & bonding).
6. Deployment artifacts (testnet) with verified-source links.
