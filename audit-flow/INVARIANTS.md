# $FLOW Protocol Invariants (dPNM model)

Properties that MUST hold across every state transition. Each invariant: **formula → rationale → enforcement site → test handle**.

Notation:
- `B[u]` — `FlowToken.balanceOf(u)`
- `S` — `FlowToken.totalSupply()`
- `P` — `IERC20(USDT).balanceOf(FlowProtocol)`
- `IL[u]` — `incomeLimit[u]`
- `ILE[u]` — `incomeLimitEverGranted[u]`
- `ILG[u]` — `incomeLimitBoughtViaGwt[u]`
- `DU[u][d]` — `dailyUsed[u][d]`
- `DX[u]` — `dailyExtra[u]` (refill from sells, 48h-window)
- `T[u]` — node in `PhenomenalTree`, with `parent`, `branches[3]`, `depth`
- `A[u]` — `activeUntil[u]`
- `G` — `GWTToken.totalSupply()`
- `F` — cumulative protocol fees ever taken (USDT)
- `price` — buy price in USDT/$FLOW (deterministic function of `S` or pool ratio)
- `now` — `block.timestamp`

---

## A. Backing (USDT ↔ $FLOW)

### INV-B-01 — Pool fully backs supply at price
**Formula:** `P >= S * price`
**Why:** dPNM closed system promise: every $FLOW redeemable.
**Where:** `FlowProtocol.buy/sell/extendTree/activate`.
**Test:** `invariant_backed()` with stateful Foundry harness; assert after every action.

### INV-B-02 — Per-user redemption capped by pool
**Formula:** `forall u: B[u] * price <= P`
**Why:** redemption never exceeds reserves.
**Where:** `sell()` should refuse if `value > P`. Should never trigger if INV-B-01 holds.
**Test:** fuzz sell with whale balance.

### INV-B-03 — `buy()` is monotonic on pool
**Formula:** `P_after_buy >= P_before_buy + (value - fee)`
**Why:** all paid USDT (minus protocol fee) credits the pool; no leak path.
**Where:** `_handleBuy`.
**Test:** unit + fuzz; check `P` delta vs `value`.

### INV-B-04 — `sell()` decreases pool by exactly `value_out`
**Formula:** `P_before - P_after == value_out` and `S_after == S_before - amountIn`.
**Where:** `_handleSell`.
**Test:** fuzz; assert tuple equality.

### INV-B-05 — No path mints $FLOW without USDT in
**Formula:** `dS/dt > 0 ⇒ dP/dt >= dS * price`
**Where:** only `_mint` site is inside `buy()` after `safeTransferFrom` succeeds.
**Test:** Slither + manual; symbolic with Halmos.

### INV-B-06 — Price monotonicity (one-way ratchet, if applicable)
**Formula:** `price_after_buy >= price_before_buy`; `price_after_sell <= price_before_sell` (if curve is bonding-style); OR `price` constant in linear-tier mode.
**Where:** `_priceAfter` pure fn.
**Test:** property test on price function.

---

## B. Income Limit

### INV-IL-01 — Non-negative
**Formula:** `forall u: IL[u] >= 0` (uint, no underflow).
**Where:** every `IL[u] -= x` site must be preceded by `if (x > IL[u]) x = IL[u]`.
**Test:** fuzz; trigger sell > IL.

### INV-IL-02 — Lifetime monotonicity
**Formula:** `ILE[u]` only ever increases.
**Why:** history is append-only; needed to compute the 10% GWT cap.
**Where:** `ILE[u] += grant` in `_grantIncomeLimit`; no decrement site.
**Test:** stateful invariant.

### INV-IL-03 — Burn equals min(value_sold, IL_before)
**Formula:** on `sell(value_out)`: `IL[u]_before - IL[u]_after == min(value_out, IL[u]_before)`.
**Why:** sell-side cap exactly burns income head-room used.
**Where:** `_burnIncomeLimitOnSell`.
**Test:** fuzz value_out ∈ [0, 2*IL]; check delta.

### INV-IL-04 — GWT-bought IL capped at 10% of lifetime
**Formula:** `forall u: ILG[u] <= ILE[u] / 10` and equivalently `ILG[u] * 10 <= ILE[u]`.
**Why:** prevents pure-GWT capture of pool.
**Where:** `buyIncomeLimitWithGwt` requires `ILG[u] + amount <= ILE[u] / 10`.
**Test:** boundary fuzz at 9.99% / 10.00% / 10.01%.

### INV-IL-05 — Income limit cannot be transferred
**Formula:** for any state transition not involving `u`, `IL[u]` and `ILE[u]` unchanged.
**Where:** no setter for these except internal grant/burn paths.
**Test:** Echidna; randomly call all external fns from `attacker`, assert no IL changes for `victim`.

### INV-IL-06 — IL grant on buy proportional
**Formula:** on `buy(value_in)`: `IL[u]_after - IL[u]_before == value_in * income_limit_factor`.
**Where:** `_grantIncomeLimit` in `_handleBuy`.
**Test:** unit; assert delta == factor*value.

### INV-IL-07 — IL never granted from tree payouts (one-way)
**Formula:** receiving `treePayout` does NOT increase `IL[u]`.
**Why:** spec — IL grows only by buying or by GWT.
**Test:** unit.

---

## C. Daily Limit

### INV-DL-01 — Daily cap respected
**Formula:** `forall u, d: DU[u][d] <= max(50e18, P * 0.001) + DX[u]_active`
**Where:** atomic check-and-increment in `_consumeDaily`.
**Test:** fuzz two-tx-same-block.

### INV-DL-02 — Daily resets at day rollover
**Formula:** `today = now / 1 days`; `DU[u][today]` is independent storage slot from `DU[u][today-1]`.
**Where:** `_today()` helper.
**Test:** time-warp.

### INV-DL-03 — Sell refill expires after 48h
**Formula:** `DX[u]` only readable while `now - sellRefillTs[u] <= 48h`; afterwards `DX[u]` treated as 0.
**Where:** `_dailyExtraEffective(u)` view.
**Test:** time-warp at 47h59m and 48h01m.

### INV-DL-04 — Race-free atomic update
**Formula:** in any single tx, `DU[u][today]_pre + amount <= cap` is checked AND `DU` written before any external call (CEI).
**Where:** `_consumeDaily` before `safeTransfer`.
**Test:** reentrancy harness.

---

## D. Phenomenal Tree

### INV-T-01 — Maximum depth
**Formula:** `forall u: depth(u) <= 10`
**Where:** `_placeNode` recursion bounded; assert.
**Test:** stateful; activate 1M users; assert depths.

### INV-T-02 — Branching factor
**Formula:** `forall u: |branches(u)| <= 3`
**Where:** `_placeNode` requires `branches(parent).length < 3`.
**Test:** unit boundary at 3rd vs 4th child.

### INV-T-03 — Acyclic
**Formula:** walking `parent` chain from any `u` terminates at `root` (no loop).
**Where:** activation requires `referrer != self` and `_assertNoCycle`.
**Test:** invariant Echidna — random graph operations preserve acyclicity.

### INV-T-04 — Spillover lands on minimum-load branch
**Formula:** for new user `n` with referrer `r`: `parent(n) ∈ argmin_{x in subtree(r) at depth<10}|branches(x)|`.
**Why:** prevents whales from steering structure.
**Where:** `_findSpilloverSlot`.
**Test:** unit + property; ensure determinism.

### INV-T-05 — Activation is one-shot
**Formula:** `activated[u]` flips false→true exactly once; never back.
**Where:** `activate` requires `!activated[u]` then sets true.
**Test:** unit attempt double-activate.

### INV-T-06 — Tree state immutable post-placement
**Formula:** `parent(u)` and position never change after activation.
**Where:** no setter post `activate`.
**Test:** invariant.

---

## E. Active Window

### INV-A-01 — Active window bounded
**Formula:** `A[u] - now <= 90 days` always (after a fresh extend).
**Where:** `extendTree` uses `A[u] = max(A[u], now) + duration` and `require(A[u] <= now + 90 days)`.
**Test:** fuzz repeated extends.

### INV-A-02 — Inactive ancestors skip payout
**Formula:** during tree payout, only `u` with `A[u] >= now` receives; rest skipped (or queued to roll-up depending on design — must match spec).
**Where:** `_payTree` loop.
**Test:** unit — toggle one ancestor inactive, assert skipped.

### INV-A-03 — Activation requires payment
**Formula:** `extendTree` increases `A[u]` only after `safeTransferFrom(u, this, value)` succeeds.
**Where:** CEI in `extendTree`.
**Test:** mock USDT failing transfer → no `A[u]` change.

---

## F. GWT

### INV-G-01 — 1:1 mint vs fees
**Formula:** `G == F` at all times (or `G <= F` with `F - G` = burned).
**Why:** GWT is the compensating receipt for protocol fees.
**Where:** every fee charge in `FlowProtocol` calls `gwt.mint(payer, fee)`; no other mint path.
**Test:** ghost variable tracking fees; invariant `G == ghost_F`.

### INV-G-02 — Only FlowProtocol mints
**Formula:** `msg.sender == FlowProtocolAddress` is the sole gate to `GWTToken.mint`.
**Where:** `onlyMinter` modifier; minter set in constructor and immutable.
**Test:** attempt mint from EOA → revert.

### INV-G-03 — Burn-for-IL respects 10% cap
Same as INV-IL-04, plus `G_after == G_before - amount` (must burn exactly what is consumed).
**Where:** `buyIncomeLimitWithGwt` calls `gwt.burnFrom(u, amount)`.

### INV-G-04 — No GWT payout from tree
**Formula:** tree rewards are paid in $FLOW (or USDT) but not GWT.
**Where:** `_payTree`.

---

## G. Aggregate / Cross-cutting

### INV-X-01 — totalSupply equals sum of balances
**Formula:** `S == Σ B[u]`.
**Where:** OZ ERC20 standard; rely on inherited tests but include in suite.

### INV-X-02 — No reentrant state observed
**Formula:** in any external function, on entry `nonReentrant` is held; reads after external calls match writes before.
**Where:** all state-changing externals.
**Test:** Echidna with malicious USDT.

### INV-X-03 — Pause halts mutators only
**Formula:** when paused: `buy`/`sell`/`activate`/`extendTree`/`buyIncomeLimitWithGwt` revert; views still serve.
**Where:** `whenNotPaused` modifier.

### INV-X-04 — Owner cannot drain USDT
**Formula:** `rescueERC20(token)` reverts when `token == USDT`.
**Where:** owner helper.

### INV-X-05 — No floating-point math
**Formula:** all rates use integer ratios (`numerator/denominator`) with denom ≥ 1e4 (bps); no `Math.exp` or PRBMath unless explicitly reviewed.

Total invariants documented: **30**.

---

## Suggested test harness

- Foundry stateful invariants: `test/flow/invariants/*.t.sol`
- Echidna: `echidna-test test/flow/echidna/FlowProtocolEchidna.sol --config echidna.yaml`
- Halmos symbolic for `_priceAfter`, `_consumeDaily`.
- Per-invariant ghost variables tracked in `harness/Ghost.sol`.
