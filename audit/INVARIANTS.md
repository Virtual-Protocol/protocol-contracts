# AgentFlow — Protocol Invariants

Invariants are properties that **must hold for every reachable state** of the protocol.
Auditors and fuzz tests should attempt to violate each one. Each invariant lists:
formula, intuition, contract & function where enforced, and a difficulty rating
(how hard to prove formally).

Difficulty: ★ trivial / ★★ static / ★★★ requires invariant fuzzing / ★★★★ requires
formal verification.

---

## A. Accounting invariants

### A1. Referral payouts bounded by collected fees
**Formula:** `Σ pendingRewards[u][t] + Σ claimedRewards[u][t] ≤ Σ collectedRefFees[t]`
for every paymentToken `t`.
**Why:** Protocol cannot pay out more cashback than fees it has accrued.
**Where:** `ReferralPayouts.credit()`, `ReferralPayouts.claim()`.
**Difficulty:** ★★★

### A2. Token conservation on bonding curve
**Formula:** `bondingCurve.tokenReserve(token) + paymentToken.balanceOf(curve)
+ Σ user.balances == initialMint` while token is pre-graduation.
**Why:** No token leakage; curve holds what it should.
**Where:** `Bonding.swap`, `BondingV5.swap`.
**Difficulty:** ★★★

### A3. Pending rewards never negative
**Formula:** `∀ user u, token t: pendingRewards[u][t] ≥ 0`.
**Why:** uint256 trivially, but underflow on debit must be impossible.
**Where:** `ReferralPayouts._debit()`.
**Difficulty:** ★

### A4. Total pending equals contract balance per token
**Formula:** `Σ_u pendingRewards[u][t] ≤ paymentToken[t].balanceOf(payouts)`
**Why:** Contract is solvent for all claims.
**Where:** `ReferralPayouts` global invariant.
**Difficulty:** ★★★

### A5. Claimed monotonic
**Formula:** `claimedRewards[u][t]` is non-decreasing.
**Why:** No way to re-credit historical claims.
**Where:** `claim()`.
**Difficulty:** ★

---

## B. Bonding curve invariants

### B1. Constant product invariant
**Formula:** After every swap, `(reserveIn + amountInAfterFee) * (reserveOut - amountOut)
≥ reserveIn * reserveOut`.
**Why:** No slippage manipulation; price moves correctly.
**Where:** `FRouter.swap`, `Bonding.buy/sell`.
**Difficulty:** ★★

### B2. Reserves non-zero pre-graduation
**Formula:** `reserveToken > 0 ∧ reservePayment > 0` until `graduated[token] == true`.
**Why:** Curve always has liquidity.
**Where:** `Bonding`.
**Difficulty:** ★★

### B3. Price monotonic-by-direction within a tx
**Formula:** Buy → price up; Sell → price down. No swap can result in `price_after <
price_before` after a buy.
**Why:** Sandwich resistance baseline.
**Where:** `Bonding.buy`.
**Difficulty:** ★★

### B4. Tax bps within range
**Formula:** `0 ≤ taxBps[token] ≤ MAX_TAX_BPS (1000)` always.
**Why:** Owner cannot extort.
**Where:** `Bonding.setTaxBps`.
**Difficulty:** ★

### B5. Fee deduction order preserved
**Formula:** `amountOut(amountIn) == curveOut(amountIn * (10000 - feeBps) / 10000)`
**Why:** Fee taken from input, never output, deterministic.
**Where:** `FRouter._getAmountOut`.
**Difficulty:** ★★

### B6. Graduation threshold one-shot
**Formula:** Once `graduated[token] == true`, no more `swap` is permitted on the
internal curve; pair address becomes immutable.
**Why:** No oscillation between curve and AMM.
**Where:** `Bonding.swap`.
**Difficulty:** ★★

---

## C. Referral tree invariants

### C1. Acyclic tree
**Formula:** `¬ ∃ user u: u ∈ ancestors(u)`.
**Why:** Cycles cause infinite distribution loops.
**Where:** `ReferralRegistry.register` — must reject if `referrer == msg.sender` or
walking up reaches `msg.sender`.
**Difficulty:** ★★★

### C2. Single referrer
**Formula:** `referrerOf[u]` is set at most once; subsequent `register` calls revert.
**Why:** Lazy registration immutability.
**Where:** `register`.
**Difficulty:** ★

### C3. Self-reference forbidden
**Formula:** `∀ u: referrerOf[u] ≠ u`.
**Where:** `register`.
**Difficulty:** ★

### C4. Distribution depth bounded
**Formula:** Reward distribution loop iterates ≤ `MAX_REFERRAL_DEPTH` (10 in v1).
**Why:** Gas DoS prevention.
**Where:** `ReferralPayouts._distribute`.
**Difficulty:** ★★

### C5. Sum of level bps ≤ 10000
**Formula:** `Σ levelBps[1..N] + protocolFeeBps ≤ 10000`.
**Why:** Cannot over-allocate fee.
**Where:** `setLevelBps`.
**Difficulty:** ★

### C6. Self-as-referrer impossible via batch import
**Formula:** No `(u, u)` pair accepted in `batchImport`.
**Where:** `batchImport`.
**Difficulty:** ★

---

## D. Migration / graduation invariants

### D1. LP locked post-graduation
**Formula:** Migrator transfers LP to a vesting/lock contract such that
`releaseTimestamp ≥ graduationTimestamp + 10 years`.
**Why:** Rug-pull resistance.
**Where:** `Migrator.graduate`.
**Difficulty:** ★

### D2. Treasury share consistent
**Formula:** `treasuryToken + lpToken + airdropToken == totalSupply` at graduation.
**Why:** Token allocation accounted for.
**Where:** `Migrator.graduate`.
**Difficulty:** ★★

### D3. Graduation atomic
**Formula:** All steps (mint LP, transfer, lock, set graduated flag, disable curve)
happen in one tx; partial state impossible.
**Where:** `Migrator.graduate`.
**Difficulty:** ★★

### D4. Pre-graduation cannot create AMM pair externally
**Formula:** Curve token cannot be added to AMM pool until protocol calls Migrator.
**Why:** Avoid front-run grad with parallel pool.
**Where:** Token contract — `transfer` to non-curve addresses gated until graduation.
**Difficulty:** ★★

---

## E. Access control invariants

### E1. Single owner per contract
**Formula:** Exactly one address `owner` per contract; transfer is two-step.
**Where:** `Ownable2Step`.
**Difficulty:** ★

### E2. Privileged calls always nonReentrant
**Formula:** Every `external` state-changing function with cross-contract call has
`nonReentrant` modifier.
**Where:** all bonding/payouts/registry external state changers.
**Difficulty:** ★

### E3. Pause respects critical functions only
**Formula:** When paused, `swap`, `claim`, `register` revert; `view` and emergency
exit do not.
**Where:** `whenNotPaused`.
**Difficulty:** ★

### E4. Authorized crediter is exactly one address
**Formula:** `|authorizedCrediters| == 1`.
**Where:** `ReferralPayouts`.
**Difficulty:** ★

---

## F. Economic invariants

### F1. No free mint
**Formula:** No path increases user balance of `token` without equivalent
paymentToken in (or pre-mint allocation).
**Where:** `Bonding.buy`, `FERC20.transfer`.
**Difficulty:** ★★★

### F2. No free pendingRewards
**Formula:** Every `_credit(u, amount)` corresponds to fees collected in same tx of
≥ amount.
**Where:** `ReferralPayouts._credit`.
**Difficulty:** ★★★

### F3. Refund completeness
**Formula:** Excess paymentToken sent in over `amountIn` returns to sender (slippage
refund). No dust accumulation.
**Where:** `FRouter.swap`.
**Difficulty:** ★★

### F4. Protocol fee accumulator monotonic
**Formula:** `protocolFees[t]` only increases (or decreases by exactly the amount
withdrawn by `treasury`).
**Where:** `Bonding`.
**Difficulty:** ★★

---

## Hardest-to-prove invariants (call out for auditors)

1. **A1 — Payouts ≤ Fees** — requires tracking per-token-per-block accumulation,
   easy to violate if `credit()` called outside the swap path.
2. **F1 — No free mint** — requires checking every state-changing path of FERC20
   plus router; fuzz w/ Foundry invariant tests + Echidna.
3. **C1 — Acyclic tree** — `batchImport` is the danger zone; if owner imports a
   malformed pair, runtime distribution can revert or burn gas.
4. **B1 — Constant product** — needs careful rounding direction on every fee math
   step; stat. testing with Echidna is required.

---

## Test coverage requirement

Every invariant above MUST be enforced by at least one Foundry invariant test
(`forge test --match-contract Invariant_*`). Coverage target ≥ 95% line, 100%
branch on referral & bonding files.
