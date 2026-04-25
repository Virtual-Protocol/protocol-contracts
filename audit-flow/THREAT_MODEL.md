# $FLOW Threat Model — STRIDE (dPNM model)

Scope: `contracts/flow/{FlowToken,FlowProtocol,PhenomenalTree,GWTToken}.sol`. $FLOW is the AgentFlow token implementing the **dPNM closed-system model**.
Methodology: STRIDE per asset/flow. Each row: **Impact** (1–5) / **Likelihood** (1–5) / **Mitigation**.

Assets in scope:
- USDT pool (escrowed in `FlowProtocol`)
- `balance[user]` ($FLOW)
- `income_limit[user]`, `income_limit_total_ever[user]`
- `daily_used[user][day]`, `daily_extra[user]`
- `tree[user]` (parent, branches, depth)
- `active_until[user]`
- `GWT.totalSupply`, `GWT.balanceOf`
- protocol parameters: `income_limit_factor`, `min_buy`, `daily_cap_bps`, fee schedule
- `owner` / multisig role(s)

Likelihood key: 1 rare, 5 trivial. Impact key: 1 cosmetic, 5 protocol-killing.

---

## 1. Spoofing (S)

### S-01 — Sybil referral fork (key threat)
- **Vector:** attacker generates 100k EOA addresses, recursively self-refers to fill 3×10 sub-tree under their own root, capturing all spillover slots.
- **Impact:** 5 — real users routed away from the attacker's branch, organic spillover econ broken; attacker collects every L1–L10 reward in their forest.
- **Likelihood:** 4 — only cost is `min_buy` per node; if `min_buy` USDT is small the attack becomes profitable from L3+ rewards.
- **Mitigation:**
  - Force `min_buy >= economically meaningful threshold` and price activation to make 100k Sybils > expected reward stream.
  - Cap `income_per_address_per_day` regardless of tree depth.
  - Track per-`tx.origin`/per-IP signal off-chain and gate activation through KYC layer or attested signer (signed `activate(user, sig)` from backend).
  - Consider commit/reveal placement: spillover slot computed from a future block hash so attacker cannot deterministically pre-fill.

### S-02 — Self-referral
- **Vector:** `referrer == msg.sender` or A→B→A cycle.
- **Impact:** 4 — inflates payouts to one entity.
- **Likelihood:** 5 — trivial without a check.
- **Mitigation:** require `referrer != msg.sender` and walk up `parent` chain forbidding `msg.sender`. Implement `_assertNoCycle` in `PhenomenalTree.activate`.

### S-03 — Front-run referrer registration
- **Vector:** Alice broadcasts `activate(ref=ghostAddr)` where `ghostAddr` is unactivated; an attacker observes the mempool, sends `activate(ghostAddr, ref=attacker)` first → ghost ends up under attacker, Alice's intended branch is broken.
- **Impact:** 3.
- **Likelihood:** 4.
- **Mitigation:** require `referrer.activated == true` at activation time; reject pending references.

### S-04 — Spoofed signature on permitted activation
- **Vector:** if `activate` accepts EIP-712 signature from a relayer, replay across chains.
- **Impact:** 3.
- **Likelihood:** 2.
- **Mitigation:** include `chainId`, `nonce`, `verifyingContract` in domain separator; nonce per user.

### S-05 — Identity confusion via contract wallets
- **Vector:** referrer is a smart-wallet; ownership later transfers; rewards continue to a new owner.
- **Impact:** 2.
- **Likelihood:** 3.
- **Mitigation:** document; optionally `require(referrer.code.length == 0)` for spillover qualification.

---

## 2. Tampering (T)

### T-01 — Tamper `income_limit_factor`
- **Vector:** owner increases `income_limit_factor` post-hoc, retroactively granting old buys higher caps.
- **Impact:** 5 — pool drained via legit-looking sells.
- **Likelihood:** 3.
- **Mitigation:** `income_limit_factor` immutable, or only changeable via 48h timelock + multisig + max-step bound (`new <= old * 1.10`). Apply only to *future* buys (snapshot at buy time).

### T-02 — Tamper `daily_limit` mid-block (race)
- **Vector:** two TXs in same block: TX1 sells 50 USDT, TX2 sells 50 USDT; both read `daily_used = 0` → both pass cap.
- **Impact:** 3.
- **Likelihood:** 4.
- **Mitigation:** read-modify-write must be atomic — increment then check (`require(daily_used[user][today] += amount <= cap)`). No early `view` cache.

### T-03 — Tamper `min_buy`
- **Vector:** owner lowers `min_buy` → enables cheap Sybil farming (chains S-01).
- **Impact:** 5 (combined).
- **Likelihood:** 2.
- **Mitigation:** timelock + lower bound (`min_buy >= MIN_BUY_FLOOR`).

### T-04 — Tamper `active_until`
- **Vector:** logic bug or owner backdoor extends activation without payment.
- **Impact:** 4.
- **Likelihood:** 2.
- **Mitigation:** `active_until` only modifiable in `extendTree(value)` after USDT received; no setter; event-emit; invariant test.

### T-05 — Tamper income_limit on burn
- **Vector:** sell flow forgets to burn `income_limit` — user keeps earning after capped sell.
- **Impact:** 5.
- **Likelihood:** 3 (logic bug class).
- **Mitigation:** burn in same tx as sell; assert post-condition; fuzz harness.

### T-06 — Tamper tree on re-activation
- **Vector:** `activate` callable twice; second call overwrites parent / position to a more profitable branch.
- **Impact:** 4.
- **Likelihood:** 3.
- **Mitigation:** `require(!activated[user])`; `activated` flips once.

### T-07 — Storage collision via proxy upgrade
- **Vector:** UUPS upgrade reorders storage slots; income_limit overwrites balance.
- **Impact:** 5.
- **Likelihood:** 2.
- **Mitigation:** OZ `@custom:storage-location` + namespaced storage; `forge inspect storageLayout` diff in CI; prefer non-upgradeable.

---

## 3. Repudiation (R)

### R-01 — No event on tree payout
- **Vector:** an ancestor receives reward but no `TreeRewardPaid(user, level, amount)` event.
- **Impact:** 3 — accounting / dispute resolution impossible.
- **Likelihood:** 3.
- **Mitigation:** emit on **every** non-zero level payout; include `levelsSkipped` array.

### R-02 — No event on income_limit burn
- **Impact:** 3.
- **Mitigation:** `IncomeLimitBurned(user, prev, next, reason)`.

### R-03 — No event on daily_limit refill
- **Impact:** 2.
- **Mitigation:** `DailyExtraGranted(user, amount, expiresAt)`.

### R-04 — No event on parameter change
- **Impact:** 4 — community cannot detect a malicious `setIncomeLimitFactor`.
- **Mitigation:** every setter emits; mirror to off-chain alerting.

---

## 4. Information Disclosure (I)

### I-01 — Tree topology fully public
- **Vector:** all branches, parents, balances readable on-chain.
- **Impact:** 3 — enables targeting (see I-02, M-08).
- **Likelihood:** 5 — by design of EVM.
- **Mitigation:** accept; do **not** rely on tree privacy for fairness; design economic invariants under full visibility.

### I-02 — MEV target selection from tree
- **Vector:** searcher reads `parent` chain → identifies which root captures the largest L10 payout → sandwiches victim's `extendTree`.
- **Impact:** 3.
- **Likelihood:** 3.
- **Mitigation:** discrete payout amounts (no slippage surface); flat per-level reward, not %-of-volume.

### I-03 — Income-limit history reveals strategy
- **Impact:** 1 — privacy only.
- **Mitigation:** acceptable.

### I-04 — Pool USDT visible enables bank-run signalling
- **Vector:** when pool USDT < threshold, all whales sell first.
- **Impact:** 3.
- **Mitigation:** structural — circuit breaker / `pause()` if `pool_USDT/totalSupply` drops below floor.

---

## 5. Denial of Service (D)

### D-01 — Tree payout DoS via expensive fallback (CRITICAL)
- **Vector:** ancestor at L7 is a contract whose `receive()` reverts or burns 5M gas. `extendTree` push-payment loop reverts → no one above receives.
- **Impact:** 5 — entire tree above griefer is poisoned.
- **Likelihood:** 4 — easy to deploy.
- **Mitigation:** **MANDATORY** pull-payment pattern. `extendTree` only credits `pendingReward[ancestor]`; ancestor calls `claim()` separately. Wrap any push in `try/catch` + skip-on-fail with event.

### D-02 — Spillover algorithm O(n) DoS
- **Vector:** `_findSpilloverSlot` scans entire tree BFS; once tree has 100k nodes, gas exceeds block limit → `activate` permanently bricked.
- **Impact:** 5.
- **Likelihood:** 3.
- **Mitigation:** maintain `nextOpenSlot[root]` pointer; placement is O(1). Or precompute placement off-chain and pass `parentHint` validated on-chain (`require(branches(parentHint) < 3)`).

### D-03 — Gas griefing on `sell` via reentrant token
- **Vector:** USDT replaced by malicious token in upgrade; transfer hook costs ∞ gas.
- **Mitigation:** USDT address immutable; verify on deploy; no setter.

### D-04 — Storage bloat
- **Vector:** Sybil registers 1M leaves to inflate storage and slow client RPCs.
- **Impact:** 2.
- **Mitigation:** activation cost > storage subsidy; not on-chain DoS but off-chain cost.

### D-05 — Block-stuffing during sell window
- **Vector:** attacker stuffs blocks at end-of-day to prevent victims from refreshing daily_limit.
- **Impact:** 2.
- **Likelihood:** 2.
- **Mitigation:** acceptable.

### D-06 — Pause griefing
- **Vector:** owner pauses indefinitely; user funds locked.
- **Impact:** 4.
- **Mitigation:** pause has max duration (e.g. 7 days) auto-expiring; emergency-withdraw path for users after timeout.

---

## 6. Elevation of Privilege (E)

### E-01 — Owner mints $FLOW directly
- **Vector:** `mint()` callable by owner outside the buy() path → pool no longer fully backed.
- **Impact:** 5.
- **Likelihood:** 2.
- **Mitigation:** no `mint`; only `_mint` inside `buy()`. Token has `MINTER_ROLE` bound to protocol contract only and renounceable.

### E-02 — Owner withdraws pool USDT
- **Vector:** any `rescueERC20` covering USDT.
- **Impact:** 5.
- **Mitigation:** `rescueERC20` MUST `require(token != USDT)`. Comment + custom error.

### E-03 — Owner sets `income_limit` per user
- **Vector:** backdoor setter.
- **Mitigation:** none should exist; only protocol-internal mutation paths.

### E-04 — Privileged GWT mint
- **Vector:** `GWTToken.mint` callable by owner instead of FlowProtocol.
- **Impact:** 5 — burn-for-income-limit becomes free.
- **Mitigation:** `MINTER_ROLE = FlowProtocol address only`, set in constructor, role admin renounced.

### E-05 — Upgrade authority
- **Vector:** UUPS `_authorizeUpgrade` left to single EOA owner.
- **Mitigation:** require multisig + timelock; ideally renounce upgrade after audit.

### E-06 — Arbitrary call helper
- **Vector:** `execute(target, data)` for "admin convenience".
- **Mitigation:** never include such a function.

---

## Summary Heatmap (top critical)

| ID | Category | I | L | Risk |
|----|----------|---|---|------|
| D-01 | Push-payment grief | 5 | 4 | 20 |
| S-01 | Sybil tree fork | 5 | 4 | 20 |
| T-01 | income_limit_factor tamper | 5 | 3 | 15 |
| D-02 | Spillover O(n) DoS | 5 | 3 | 15 |
| E-01/E-02 | Owner mint / withdraw | 5 | 2 | 10 |
| T-05 | Missed income_limit burn | 5 | 3 | 15 |
| T-06 | Re-activation overwrite | 4 | 3 | 12 |
| T-02 | Daily-limit race | 3 | 4 | 12 |

Total threats catalogued: **30** across 6 STRIDE categories.
