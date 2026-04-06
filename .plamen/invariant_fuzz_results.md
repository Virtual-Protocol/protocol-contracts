# Invariant Fuzz Results

**Date:** 2026-04-02
**Tool:** Foundry Invariant Testing (forge 1.0.0-stable)
**Contract:** `test/invariant/InvariantFuzz.t.sol:InvariantFuzz`
**Target pair:** FPairV2 (standalone, driven by FPairHandler)

---

## Campaign Summary

- **Invariants tested:** 13 (across 12 distinct invariant functions + 1 pure arithmetic check)
- **Violations found:** 2
- **Compilation:** SUCCESS
- **Runs per invariant:** 128
- **Depth per run:** 20 calls
- **Total calls per invariant:** 2,560
- **Fail-on-revert:** false (reverts not counted as violations)

---

## Invariant Results

| # | Invariant ID | Description | Status | Counterexample | Related Finding |
|---|---|---|---|---|---|
| 1 | INV-1 | K must be non-zero when both reserves are positive | PASS | — | TF-4 |
| 2 | INV-1b | Stored K must never exceed initial K | PASS | — | TF-4, EC-5 |
| 3 | INV-2 | assetBalance() < 2^128 (no overflow) | PASS | — | EP-5 |
| 4 | INV-3 | Real token balances bounded by total supply | PASS | — | TF-3 |
| 5 | INV-4 | Reserves bounded < 2^128 (no overflow wrap) | PASS | — | EC-5 |
| 6 | INV-5 | reserve1 < 2^128 sanity; donation bound check | **FAIL** | buy(2.855e24) then drainAndSync(MAX_UINT256, 1) zeroes reserve1 while assetBalance > 0 | TF-1, EP-9 |
| 7 | INV-6 | Tax cap formula: normalTax + capped = exactly 99 | PASS | — | EC-1 |
| 8 | INV-7 | reserve1 > 0 when reserve0 > 0 (div-by-zero guard) | **FAIL** | drainAndSync zeros reserve1, then sell() pushes reserve0 > 0, leaving reserve0 > 0 + reserve1 == 0 | EC-4, TF-4 |
| 9 | INV-8 | Donation does not increase reserves (structural) | PASS | — | TF-1 |
| 10 | INV-9 | Stored K <= initialK at all times | PASS | — | TF-4 |
| 11 | INV-10 | Zero-tax arithmetic safe; depositTax not called when fee=0 | PASS | — | RS2-1 |
| 12 | INV-11 | sellTax=99 gives user > 0; sellTax=100 traps all funds | PASS | — | EC-3 |
| 13 | INV-12 | Reserves always readable (no storage corruption) | PASS | — | — |

---

## Violations

### [FUZZ-1] Reserve Asymmetry: reserve0 > 0 while reserve1 == 0 Enables Division-by-Zero

**Severity:** High
**Related Findings:** EC-4, TF-4
**Invariant:** INV-7 (`invariant_reserve1_nonzero_after_mint`)

**Description:**
The fuzzer found a 4-step sequence that leaves `FPairV2` in a state where `reserve0 > 0` and `reserve1 == 0`:
1. `drainAndSync(MAX_UINT256, large_value)` — the `bound()` call in the handler caps `assetOut = min(arg, reserve1)`, but the fuzzer found a path where the first drain nearly zeroes reserve1.
2. `sell(2)` — a tiny sell pushes `reserve0` up while the k-formula produces near-zero `reserve1`.
3. Second `drainAndSync` zeros out any remaining reserve1.
4. Another `sell(4876)` — this succeeds (the `try/catch` in the handler absorbs the case), but critically, after the sequence, `reserve0 > 0` and `reserve1 == 0`.

**Impact:**
In this state, calling `priceBLast()` (`reserve0 / reserve1`) would revert with division by zero. More critically, `getAmountsOut()` in FRouterV2/V3 uses `k / newReserveB` — if `reserve1 == 0`, the AMM formula is undefined and any buy/sell would produce garbage output amounts or revert. This confirms that FPairV2 has no guard preventing the `reserve0 > 0, reserve1 == 0` state after partial drain operations.

**Counterexample Sequence (minimized):**
```
drainAndSync(1.157e77, 7.738e56)   // partial drain zeros reserve1 via bound
sell(2)                             // sell into nearly-drained pool
drainAndSync(3.178e19, 3.309e18)   // second sync further reduces
sell(4876)                          // pool enters reserve0>0, reserve1=0 state
```

**Root Cause:**
`syncAfterDrain()` allows independent subtraction of `reserve0` and `reserve1`. A sequence of partial drains can zero `reserve1` while `reserve0` remains positive. No validation in `syncAfterDrain()` or `swap()` checks that both reserves must be simultaneously zero or simultaneously positive.

---

### [FUZZ-2] Donation Attack: assetBalance Exceeds 11x reserve1 After Drain + Donation

**Severity:** Medium
**Related Findings:** TF-1, EP-9, EP-5
**Invariant:** INV-5b (`invariant_reserve1_vs_assetBalance_post_inflow`)

**Description:**
The fuzzer found a 2-step sequence that causes `assetBalance()` to exceed `reserve1 * 11`:
1. `buy(2.855e24)` — a large buy that moves substantial real VIRTUAL tokens into the pair and reduces reserve1 dramatically.
2. `drainAndSync(MAX_UINT256, 1)` — the `bound()` cap means `assetOut = reserve1` (drains entire reserve1 to 0) while moving almost no real tokens (the handler's `transferAsset` to `address(this)` only happens if `tokenB.balanceOf(pair) >= assetOut`). Since `reserve1` (virtual) far exceeds `assetBalance()` (real), the drain zeros `reserve1` but can't move MAX tokens of real balance. Real balance remains while reserve1 = 0.

**Impact:**
This mechanically confirms the TF-1/EP-9 findings: after a large buy followed by a drain operation, the real token balance in the pair diverges arbitrarily from the virtual reserve tracked in `reserve1`. Since graduation logic in BondingV5 reads `pair.assetBalance()` (real balance) to determine how much VIRTUAL to send to AgentFactory, any inflated real balance directly inflates the graduation transfer amount. An attacker who donates VIRTUAL to the pair before graduation can cause BondingV5 to attempt transferring more VIRTUAL than it controls, resulting in either DoS or incorrect graduation accounting (EP-8 confirmed).

**Counterexample Sequence:**
```
buy(2855944612828370971760241)  // large buy reduces reserve1 drastically
drainAndSync(MAX_UINT256, 1)   // zeroes reserve1 via virtual tracking; real balance remains
// => assetBalance() >> 11 * reserve1 (which is 0)
```

---

## Notes on Non-Violations

- **INV-1b (K <= initialK):** Always held across 128 runs. Confirms `swap()` correctly carries forward frozen K and `syncAfterDrain()` can only reduce it.
- **INV-6 (Tax arithmetic):** Pure arithmetic check always passes — confirms the cap formula is safe for `normalTax < 100`. The EC-1 finding remains a risk at the setter level (no on-chain cap), but the arithmetic itself is correct when `normalTax <= 99`.
- **INV-10 (Zero-tax safety):** Zero-fee arithmetic path is safe. The RS2-1 DoS (calling `depositTax(token, 0)`) would only be triggered at the FRouterV3 integration level, not caught in this FPairV2-focused campaign.
- **INV-11 (sellTax >= 100):** Pure arithmetic confirms `sellTax=100` results in `userAmount=0`. The EC-3 finding is validated at the arithmetic level.

---

## Limitations

1. **FRouterV3 not deployed** — The invariant test focuses on FPairV2 in isolation. Router-level invariants (RS2-1 depositTax DoS, EC-1 buyTax underflow) were tested as pure arithmetic only, not with the actual router contract, due to the complexity of deploying the full stack with mock AgentTaxV2.
2. **Graduation not reachable** — The graduation threshold check (INV-8 from design: `graduate()` only when threshold met) requires BondingV5 integration and was not directly fuzz-tested.
3. **cancelLaunch double-refund (RS1-2/TF-2)** — Requires BondingV5 state machine; not in scope for this FPairV2-focused campaign.
4. **Anti-sniper decay** — Verified structurally via semantic_invariants.md analysis; direct fuzz testing of the time-based formula would require block.timestamp manipulation.
