# $FLOW Pre-audit Checklist (dPNM model)

Per-contract compliance gates. Each item: `[ ]` not yet, `[x]` done. Auditor verifies independently.

Legend: `MUST` = blocker; `SHOULD` = strong recommendation; `NICE` = optional polish.

---

## Cross-cutting (all four contracts)

- [ ] **MUST** Solidity `^0.8.24`; floating pragma not allowed in production deploy.
- [ ] **MUST** OpenZeppelin Contracts pinned to exact `5.x.y` in `package.json`; no `^` or `~`.
- [ ] **MUST** No floating-point math; all rates expressed as `numerator / denominator` with denominator ≥ 1e4 bps.
- [ ] **MUST** All external state-changing functions have `nonReentrant` modifier.
- [ ] **MUST** Custom errors only; no `require("string")` strings in production paths.
- [ ] **MUST** Every state mutation emits an event (transfer, mint/burn, IL grant/burn, daily refill, activation, parameter change, pause).
- [ ] **MUST** No `delegatecall` to user-supplied targets.
- [ ] **MUST** No `selfdestruct`.
- [ ] **MUST** No assembly except for SafeERC20-style operations and gas-bounded loops.
- [ ] **MUST** `block.timestamp` usage tolerates BSC miner drift ±900s; no equality check on timestamps.
- [ ] **MUST** No use of `tx.origin` for auth.
- [ ] **MUST** All math performed in `uint256`; explicit `SafeCast` for any narrowing.
- [ ] **MUST** Pause mechanism (`Pausable`) on every mutator; max-pause-duration self-expiring.
- [ ] **MUST** Owner has explicit allowlist of functions; no catch-all `execute(target,data)`.
- [ ] **MUST** `rescueERC20` rejects USDT and protocol tokens.
- [ ] **MUST** Contracts under 24576 byte EIP-170 limit.
- [ ] **SHOULD** UUPS upgrade gated by `MULTISIG + Timelock(48h)`; `_authorizeUpgrade` properly restricted; OR contracts deployed non-upgradeable (preferred).
- [ ] **SHOULD** OZ `@custom:storage-location` namespaced storage if upgradeable.
- [ ] **SHOULD** Storage layout snapshot diffed in CI (`forge inspect storageLayout`).
- [ ] **SHOULD** Slither, Mythril, Echidna, Halmos all green in CI.
- [ ] **NICE** ERC-1967 admin events on upgrades.

---

## `FlowToken.sol`

- [ ] **MUST** Inherits `ERC20`, `ERC20Permit`, `AccessControl` (or `Ownable2Step` + minter mapping).
- [ ] **MUST** `mint` / `burn` callable ONLY by `FlowProtocol` (constructor-set, immutable).
- [ ] **MUST** `MINTER_ROLE` admin renounced after deploy; documented in deploy script.
- [ ] **MUST** No transfer fee, no rebasing, no fee-on-transfer logic.
- [ ] **MUST** `decimals()` = 18.
- [ ] **MUST** `permit` uses `EIP712` domain with `chainId` (no caching pre-fork chainId).
- [ ] **SHOULD** `_update` hook does not introduce reentrancy paths.
- [ ] **NICE** Events `MinterChanged` if minter ever migrates.

---

## `FlowProtocol.sol`

### Buy / Sell

- [ ] **MUST** `buy()` follows CEI: `safeTransferFrom` → `_grantIL` → `_mint` → `gwt.mint(fee)` → emit `Bought`.
- [ ] **MUST** `sell()` follows CEI: `_burn` → `_burnIL(min(value, IL))` → `_consumeDaily(value)` → `gwt.mint(fee)` → `safeTransfer` → emit `Sold`.
- [ ] **MUST** `MAX_BUY` and `MIN_BUY` enforced on every buy; values configurable via timelocked setter with bounds.
- [ ] **MUST** `slippageBound` parameter accepted on `buy` and `sell` (min out / max in).
- [ ] **MUST** Income-limit factor snapshot taken at `buy` time and stored per-grant; no retroactive recomputation.
- [ ] **MUST** Sell-to-pool redemption never causes `P < 0`; pool balance read after transfer to assert.

### Daily Limit

- [ ] **MUST** `_consumeDaily(amount)` is atomic check-and-increment; uses `unchecked` only after explicit overflow guard.
- [ ] **MUST** `dailyCap = max(50e18, pool * 0.001)` recomputed at consumption time.
- [ ] **MUST** `dailyExtra` from sell expires after exactly 48h; uses `block.timestamp + 48 hours`.
- [ ] **SHOULD** Grace transition at day rollover handled (no off-by-one allowing > cap).

### Income Limit

- [ ] **MUST** `IL[u]`, `ILE[u]`, `ILG[u]` all non-negative `uint256`.
- [ ] **MUST** `_burnIL` clamps at `IL[u]`; never underflows.
- [ ] **MUST** `buyIncomeLimitWithGwt` enforces `ILG[u] + amount <= ILE[u] / 10`.
- [ ] **MUST** No external setter for `IL/ILE/ILG`.

### Activation / ExtendTree

- [ ] **MUST** `activate` is `nonReentrant` and one-shot (`require(!activated[u])`).
- [ ] **MUST** `referrer != msg.sender`; `referrer.activated == true`.
- [ ] **MUST** Tree placement via O(1) `nextOpenSlot` pointer or validated `parentHint`; no unbounded BFS.
- [ ] **MUST** `extendTree` increases `activeUntil` only after USDT received; bounded by `now + 90 days`.
- [ ] **MUST** Tree payouts use **pull-payment** (`pendingReward[ancestor] += share`); no synchronous external calls during payout loop.
- [ ] **MUST** `claim()` separate function, `nonReentrant`, CEI.

### Pause / Roles

- [ ] **MUST** All mutators `whenNotPaused`.
- [ ] **MUST** Owner cannot mint $FLOW or GWT directly.
- [ ] **MUST** `setIncomeLimitFactor`, `setMinBuy`, `setDailyCapBps` go through Timelock(48h) + bounded change (`new <= old * 1.10`).

---

## `PhenomenalTree.sol`

- [ ] **MUST** Hard cap `MAX_DEPTH = 10`; `_placeNode` reverts if would exceed.
- [ ] **MUST** Hard cap `BRANCH_FACTOR = 3`; reverts on 4th child.
- [ ] **MUST** `_assertNoCycle(referrer)` walks parent chain (bounded by 10) and rejects if `msg.sender` ∈ chain.
- [ ] **MUST** `nextOpenSlot[parent]` pointer maintained on every placement.
- [ ] **MUST** Spillover deterministic: `argmin |branches|` using stable iteration order.
- [ ] **MUST** `viewNode(u)` view-only; no state mutation.
- [ ] **MUST** No public `setParent`, `setBranches`; placement only via `placeNode` from `FlowProtocol`.
- [ ] **SHOULD** Emit `Placed(u, parent, depth)` on every activation.

---

## `GWTToken.sol` / `FlowGrowToken.sol`

- [ ] **MUST** `MINTER_ROLE` set in constructor to `FlowProtocol` address; immutable.
- [ ] **MUST** `mint` callable only by minter; revert otherwise.
- [ ] **MUST** `burnFrom` follows ERC20Burnable; `burn` callable by holder.
- [ ] **MUST** No owner-only `mint` path.
- [ ] **MUST** `decimals()` = 18.
- [ ] **MUST** Total minted ≤ total fees ever charged (assert via ghost in tests).
- [ ] **SHOULD** Emit `MintedForFee(user, fee)` distinguishable from generic `Transfer`.

---

## Tests / CI gates

- [ ] **MUST** Statement coverage ≥ 95% on `contracts/flow/*`.
- [ ] **MUST** Branch coverage ≥ 90%.
- [ ] **MUST** All 30 invariants in `INVARIANTS.md` have a corresponding Foundry/Echidna assertion.
- [ ] **MUST** All 15 attack scenarios in `ATTACK_SCENARIOS.md` have a failing-then-passing test.
- [ ] **MUST** Slither: zero High, ≤ 3 Medium with documented justification.
- [ ] **MUST** Mythril: zero High.
- [ ] **MUST** CI fails the PR if any of the above regress.

---

## Deployment / operational

- [ ] **MUST** Owner = `Timelock(48h)` whose proposer is Gnosis Safe 3-of-5.
- [ ] **MUST** Multisig signers list documented and rotated keys.
- [ ] **MUST** Emergency runbook: pause procedure, rollback, comms.
- [ ] **MUST** Monitoring: balance drift, daily volume, GWT vs fees ratio, pool/supply ratio alarms.
- [ ] **SHOULD** On-chain canary monitor that pauses if `INV-B-01` violates.
- [ ] **SHOULD** Public bug bounty before mainnet open.

---

## Documentation

- [ ] **MUST** Public spec doc explaining: dPNM model, income-limit math, daily-limit math, tree structure, GWT mechanics.
- [ ] **MUST** NatSpec on every external function.
- [ ] **MUST** README links to: this audit folder, deployed addresses, audit reports, bounty page.
