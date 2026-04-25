# $FLOW Attack Scenarios (dPNM model)

15 concrete attack scenarios with **pre-conditions / steps / impact / mitigation / test reference**. Every scenario maps to one or more invariants in `INVARIANTS.md` and a STRIDE row in `THREAT_MODEL.md`.

---

## A-01 — Sybil tree fork (CRITICAL)

- **Maps to:** S-01, INV-T-04.
- **Pre-conditions:** `min_buy` ≤ ~5 USDT; tree placement deterministic; attacker funds 100k addresses with `min_buy + gas`.
- **Steps:**
  1. Attacker EOA `R` activates as root referrer of an honest community group.
  2. Attacker scripts 100k EOAs `s_1..s_100000`, each `activate(referrer=R)` (or chained beneath previous).
  3. Tree fills by spillover; honest `min` slot is always occupied by another sybil.
  4. When real users join under `R`, they are placed in the deepest sub-branch among sybils.
  5. Attacker collects every L1–L10 reward stream.
- **Impact:** captures ~100% of tree payouts under `R`; real users see near-zero ROI; community trust gone.
- **Mitigation:** raise `min_buy`; gate `activate` with backend signature (off-chain anti-sybil); make spillover slot dependent on `keccak(blockhash, user)` so attacker cannot precompute placement; cap rewards/address/day.
- **Test:** `test/flow/attacks/SybilFork.t.sol` — simulate 1k sybils, assert real-user payout share ≥ X.

---

## A-02 — Income limit overflow

- **Maps to:** T-05, INV-IL-01/06.
- **Pre-conditions:** `IL[u]` stored as `uint256` but multiplied by `income_limit_factor` without overflow check, OR cast down to `uint128`.
- **Steps:**
  1. Whale buys with `value = 2^200 / factor` (test-net edge case).
  2. `IL[u] += value * factor` overflows or truncates.
  3. Either `IL` becomes 0 (whale loses cap) **or** wraps to large negative-ish via downcast.
- **Impact:** under-cap user ⇒ economic exploit if wraps high.
- **Mitigation:** Solidity 0.8.x default checked math; explicitly assert no downcast; cap `value` at `MAX_BUY`.
- **Test:** fuzz `value` near `type(uint128).max`.

---

## A-03 — Daily limit race in same block

- **Maps to:** T-02, INV-DL-01/04.
- **Pre-conditions:** two TXs from same `u` in same block; `DU[u][today]` read as cached view in helper.
- **Steps:**
  1. `u.sell(50)` — TX1.
  2. `u.sell(50)` — TX2 in same block.
  3. If implementation does `if (view_DU + amount <= cap) ... transfer ... DU += amount` with the read materialised in memory before the call sequence is atomic, both pass.
- **Impact:** small per-user; large attack surface if scripted across many users.
- **Mitigation:** strict CEI: `DU[u][today] += amount` first (Solidity 0.8 reverts on > cap if you compute `unchecked` correctly), or use `require((DU[u][today] += amount) <= cap)`. No off-cycle helper.
- **Test:** call `sell` twice in one tx via attacker contract; assert second reverts.

---

## A-04 — Self-referral

- **Maps to:** S-02, INV-T-03.
- **Pre-conditions:** `activate(referrer)` does not check `referrer != msg.sender` or cycle.
- **Steps:** A activates with `referrer = A` (or A→B→A cycle through pre-arranged accounts).
- **Impact:** rewards loop to self; accounting integrity broken.
- **Mitigation:** explicit `require(referrer != msg.sender, SelfReferral())`; `_assertNoCycle` walking parent chain (bounded by depth=10).
- **Test:** unit; both direct and 2-hop cycle.

---

## A-05 — Activate without payment via reentrancy

- **Maps to:** D-03, E-01, INV-A-03.
- **Pre-conditions:** `activate` sequence: (a) `safeTransferFrom`, (b) `_placeNode`, (c) `gwt.mint(fee)` — but `_placeNode` calls into a hook on `referrer` (e.g. for "team-bonus push") that re-enters `activate(victim)`.
- **Steps:**
  1. Attacker contract is referrer; sets fallback to call back into `activate`.
  2. Attacker triggers `activate(self, referrer=attacker)` with USDT approval = 0.
  3. Reentrant call sees `activated[victim] = false` and proceeds before outer transfer reverts.
- **Impact:** free activation.
- **Mitigation:** `nonReentrant`; CEI strictly; prefer pull-rewards (no callback to ancestors).
- **Test:** Echidna with malicious referrer contract.

---

## A-06 — GWT mint inflation

- **Maps to:** E-04, INV-G-01/02.
- **Pre-conditions:** `GWTToken.mint` reachable from any path other than `FlowProtocol` fee charge, OR fee path is duplicated.
- **Steps:** call `mint` directly, or trigger fee twice via duplicated event handler.
- **Impact:** inflated GWT → user buys 10× their entitled IL.
- **Mitigation:** single `MINTER_ROLE = FlowProtocol`; immutable; reject any other path.
- **Test:** unit — call `mint` from EOA → revert; check `G == ghost_F` after every action.

---

## A-07 — Sandwich on `buy()`

- **Maps to:** I-02, INV-B-06.
- **Pre-conditions:** price function depends on `S` (bonding curve element).
- **Steps:**
  1. Searcher sees a 50k USDT pending `buy` from victim.
  2. Searcher front-runs with own `buy` at lower price.
  3. Victim's `buy` mints at higher price.
  4. Searcher `sell`s.
- **Impact:** victim loses; pool slightly drained per cycle.
- **Mitigation:** flat per-tier price (no continuous curve), or `slippageBound` parameter on `buy`; commit-reveal for buy queue; private mempool integration (Flashbots Protect).
- **Test:** `forge test --match-test sandwich` with two-actor harness.

---

## A-08 — MEV on `extendTree` payout

- **Maps to:** I-02, D-01.
- **Pre-conditions:** payouts pushed synchronously to ancestors during `extendTree`; ancestor list inferable.
- **Steps:** searcher precomputes ancestor list, opens a position via cheap activation under that branch, becomes ancestor, captures payout share.
- **Impact:** small per-event but recurring.
- **Mitigation:** payouts are pull-based with merkle proofs of position at `extendTree` block (snapshot); flat per-level reward independent of ancestor count.
- **Test:** simulate ancestor injection across 1 block.

---

## A-09 — Reentrancy on `sell` drains pool

- **Maps to:** D-03, E-02, INV-X-02.
- **Pre-conditions:** USDT swapped/extended to a token with hooks (USDT itself has no `transfer` hook on BSC, but if migrate to USDC.e or token-with-callback this opens). Or transfer `value` to user before updating `B[u]`.
- **Steps:**
  1. Attacker calls `sell(amount)`; protocol sends USDT first.
  2. Attacker contract `tokensReceived` re-enters `sell(amount)`; `B[u]` still un-decremented.
  3. Loop until pool empty.
- **Impact:** total pool drain.
- **Mitigation:** `nonReentrant`; CEI (`_burn` → `IL` burn → `safeTransfer`); reject non-whitelisted accept tokens; SafeERC20.
- **Test:** Foundry harness with malicious ERC777-style token swapped in (negative test should fail to swap; but for safety run with custom test token).

---

## A-10 — Tree payout grief (push-payment poisoning) (CRITICAL)

- **Maps to:** D-01, INV-A-02.
- **Pre-conditions:** `_payTree` pushes USDT/$FLOW to each active ancestor synchronously.
- **Steps:**
  1. Attacker activates an account at L7 in a victim's branch.
  2. Attacker's account is a contract with `receive() { revert; }` (or `assembly { invalid() }`).
  3. Any descendant's `extendTree` reverts when the loop reaches L7 → entire tree above is starved.
- **Impact:** branch fully bricked; users cannot extend; capital trapped.
- **Mitigation:** **pull-payment only**. `_payTree` writes `pendingReward[ancestor] += share` and emits event; ancestors call `claim()` separately. Alternatively `try ... catch { skip + emit }`.
- **Test:** deploy malicious receiver, run `extendTree` from descendant, assert success and `pendingReward` accrued.

---

## A-11 — Front-run referrer registration

- **Maps to:** S-03.
- **Pre-conditions:** `referrer` need not be active at activation time.
- **Steps:**
  1. Alice signs `activate(referrer = ghost)` where `ghost` is unactivated wallet.
  2. Attacker monitors mempool, sends `activate(ghost, referrer = attacker)` with higher gas; ghost lands under attacker.
  3. Alice's tx executes; her referrer chain now flows into attacker.
- **Impact:** attacker captures Alice's upline rewards.
- **Mitigation:** `require(activated[referrer], InactiveReferrer())`; reject ghost references at activation time.
- **Test:** simulate two pending txs; assert Alice's tx reverts when ghost is unactivated.

---

## A-12 — Owner backdoor: `income_limit_factor` retro-bump

- **Maps to:** T-01, E-01.
- **Pre-conditions:** factor is mutable post-deploy without snapshot.
- **Steps:** owner (compromised key) bumps factor 10×; whale's old `IL[u]` ostensibly didn't change, but if implementation re-derives `IL` from `S * factor` views, instant exploit.
- **Impact:** silent pool drain.
- **Mitigation:** factor immutable, OR snapshot-at-buy; timelock + bound.
- **Test:** verify `IL[u]` equals sum of `(value_buy_i * factor_at_buy_i)` ignoring later factor changes.

---

## A-13 — Income limit double-burn skip

- **Maps to:** T-05, INV-IL-03.
- **Pre-conditions:** `sell` calls `safeTransfer` then `IL[u] -= burn` (broken CEI).
- **Steps:** reentrancy through transfer hook re-enters `sell` before burn applied → user sells twice while burning IL once.
- **Impact:** uncapped earnings; pool drain.
- **Mitigation:** CEI + `nonReentrant`.
- **Test:** see A-09; assert `IL[u]` decremented before transfer.

---

## A-14 — Spillover O(n) DoS

- **Maps to:** D-02, INV-T-04.
- **Pre-conditions:** `_findSpilloverSlot` is BFS over the whole subtree.
- **Steps:**
  1. Attacker fills 50k+ nodes under root.
  2. New honest user calls `activate`; BFS scan exhausts block gas.
  3. Activation perma-fails for that subtree.
- **Impact:** registration DoS; protocol unusable for a slice of users.
- **Mitigation:** maintain `nextOpenSlot[parent]` pointer (O(1) placement), or accept `parentHint` validated on-chain (`require(branches(hint) < 3 && depth(hint) < 10 && isAncestor(referrer, hint))`).
- **Test:** stateful invariant — depth grows but `activate` gas stays < 500k.

---

## A-15 — Daily-limit refill replay (48h window)

- **Maps to:** INV-DL-03.
- **Pre-conditions:** `dailyExtra` granted on sell, expires after 48h, but expiry uses `block.number` not `block.timestamp` (or vice-versa with miner manipulation).
- **Steps:** attacker sells, gains `DX`, then on day 3 abuses miner timestamp drift (≤900s on BSC) to slip `now - sellRefillTs == 47h59m59s`, gaining an extra refresh window.
- **Impact:** marginal — extra ~50 USDT sell capacity.
- **Mitigation:** use `block.timestamp` strictly; comparison `now <= sellRefillTs + 48h` is fine given miner drift bounds; document accepted ±15min drift.
- **Test:** time-warp boundary at 47h59m and 48h01m.

---

## Coverage matrix

| Scenario | THREAT_MODEL ID | INVARIANT IDs |
|----------|-----------------|---------------|
| A-01 | S-01 | INV-T-04 |
| A-02 | T-05 | INV-IL-01/06 |
| A-03 | T-02 | INV-DL-01/04 |
| A-04 | S-02 | INV-T-03 |
| A-05 | E-01, D-03 | INV-A-03 |
| A-06 | E-04 | INV-G-01/02 |
| A-07 | I-02 | INV-B-06 |
| A-08 | I-02, D-01 | — |
| A-09 | D-03, E-02 | INV-X-02 |
| A-10 | D-01 | INV-A-02 |
| A-11 | S-03 | INV-T-03 |
| A-12 | T-01, E-01 | INV-IL-06 |
| A-13 | T-05 | INV-IL-03 |
| A-14 | D-02 | INV-T-04 |
| A-15 | — | INV-DL-03 |

All scenarios should have a dedicated test in `test/flow/attacks/`.
