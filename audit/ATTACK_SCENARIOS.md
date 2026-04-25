# AgentFlow — Attack Scenarios

13 concrete attacks an auditor / red-team should attempt. Each contains
Pre-conditions, Steps, Impact, Mitigation, and the test reference where the
defense is exercised.

---

## AS-01 — Sybil referral tree (vertical farm)

**Pre-conditions:** No depth cap on rewarded levels; no minimum activity per
ancestor.
**Steps:**
1. Attacker generates 10 000 EOA addresses A0…A9999.
2. Calls `register(Ai, Ai-1)` for each → linear chain.
3. From A9999 performs a single 1 000 USDC swap on the bonding curve.
4. Reward loop walks 9 999 ancestors, all controlled by attacker → 100 % of
   referral cashback flows back to attacker as one bundle.

**Impact:** Critical — protocol pays full referral budget on every swap.
**Mitigation:** `MAX_REFERRAL_DEPTH = 10` for distribution; only first 10
ancestors credited. Per-ancestor minimum: must have at least one prior
self-funded swap of ≥ 5 USDC equivalent (anti-sybil "skin in the game").
**Test:** `test/invariants/SybilDepthBound.t.sol::test_sybil_chain_caps_at_10`.

---

## AS-02 — Front-run referrer registration

**Pre-conditions:** `register(user, ref)` permits any `msg.sender` to write
`referrerOf[user]`; user has not yet registered.
**Steps:**
1. Attacker watches mempool for a victim's first `register(victim, friend)` tx.
2. Front-runs with `register(victim, attacker)`.
3. Victim's tx reverts (already registered).
4. Attacker gets all victim's lifetime cashback.

**Impact:** High — permanent referrer hijack.
**Mitigation:** `register(referrer)` only — `msg.sender` is the registree;
nobody else can register on someone's behalf. Optional EIP-712 sponsored path
requires victim's signature.
**Test:** `test/referral/Register.t.sol::test_cannot_register_someone_else`.

---

## AS-03 — Sandwich on graduation tx

**Pre-conditions:** Graduation is executed atomically with the swap that
crosses the threshold; AMM pair is created and seeded in the same block.
**Steps:**
1. Attacker observes mempool, sees a buy that will cross graduation threshold.
2. Front-runs with massive buy on the curve at favorable price.
3. Threshold-crossing tx executes; AMM pair is created at high price.
4. Back-runs by selling on the new AMM at premium.

**Impact:** High — extracts arbitrage spread, distorts initial AMM price.
**Mitigation:** Two-phase graduation:
- Phase 1: threshold reached → curve frozen, `graduationPending = true`.
- Phase 2: anyone can call `executeGraduation()` after `gradPendingBlock + 5`.
- Curve cannot be bought between phases.
**Test:** `test/migration/Graduation.t.sol::test_no_atomic_sandwich`.

---

## AS-04 — Reentrancy on `claim`

**Pre-conditions:** Claim transfers paymentToken before zeroing
`pendingRewards`. PaymentToken is an ERC777 or has a hook that calls back.
**Steps:**
1. Attacker registers contract C as their address.
2. Accumulates `pendingRewards[C][token] = 100`.
3. Calls `claim(token)` → contract transfers 100 → C's hook re-enters claim →
   reads pending = 100 (not yet zeroed) → drains.

**Impact:** Critical — multiplied withdraw.
**Mitigation:**
- `nonReentrant` on `claim`.
- Checks-effects-interactions: zero `pendingRewards` BEFORE transfer.
- Only whitelist standard ERC20 paymentTokens (no ERC777, no fee-on-transfer
  by default).
**Test:** `test/referral/Reentrancy.t.sol::test_claim_reentrancy_blocked`.

---

## AS-05 — Approval drain via malicious router

**Pre-conditions:** UI asks user to `approve(router, type(uint256).max)` so
swaps can be one-click.
**Steps:**
1. User approves max to `FRouter`.
2. Owner-controlled router contract is upgraded to malicious version that
   calls `paymentToken.transferFrom(user, attacker, balance)` directly.

**Impact:** Critical — full wallet drain of approved token.
**Mitigation:**
- `FRouter` is **non-upgradeable** (immutable bytecode).
- For the upgradeable bonding contract, never grant infinite approval;
  router takes per-swap exact-amount transferFrom.
- UI prompts approval for `amountIn` only, not max.
**Test:** Manual review + `slither --detect arbitrary-from-in-transferFrom`.

---

## AS-06 — Price manipulation on curve via flash loan

**Pre-conditions:** Curve has no per-tx max buy / max sell.
**Steps:**
1. Attacker flash-loans 10M USDC.
2. Atomic: buy 99 % of curve supply → price spike → sells 99 % back.
3. Pays trading fee but extracts MEV from any concurrent tx priced off the
   curve oracle (e.g. another protocol reading curve price).

**Impact:** Med — third-party oracle abuse, also griefs honest buyers.
**Mitigation:**
- Per-tx max buy: `min(2 % curveSupply, 10 % paymentReserve)`.
- Curve price is NOT exposed as oracle — explicitly documented.
- Optional: rate-limit by block (one buy/sell per address per block).
**Test:** `test/bonding/MaxBuy.t.sol::test_atomic_buy_sell_capped`.

---

## AS-07 — Owner sets tax = 100 %

**Pre-conditions:** `setTaxBps(uint)` has no upper bound check.
**Steps:**
1. Compromised owner key calls `setTaxBps(token, 10000)`.
2. Next swap takes 100 % as tax; user receives 0 tokens but loses paymentToken.

**Impact:** Critical — total user fund loss on next swap.
**Mitigation:** Hard-coded constant `MAX_TAX_BPS = 1000`. `setTaxBps` reverts
if `> MAX_TAX_BPS`. Even if owner key is compromised, max extraction is 10 %.
**Test:** `test/bonding/Tax.t.sol::test_setTaxBps_above_cap_reverts`.

---

## AS-08 — Cyclic referral tree via batchImport

**Pre-conditions:** `batchImport(users[], refs[])` does not validate cycles.
**Steps:**
1. Owner imports `(A, B)` then `(B, A)`.
2. Distribution loop walks A → B → A → … OOG revert OR
   if loop bound exists, A and B drain each other's cashback indefinitely.

**Impact:** High — distribution DoS or double-counting.
**Mitigation:** `batchImport` validates each pair: walk up from `ref` for
`MAX_REFERRAL_DEPTH` steps; if `user` appears, revert. Plus runtime depth
counter clamps loop unconditionally.
**Test:** `test/referral/BatchImport.t.sol::test_cyclic_import_reverts`.

---

## AS-09 — Griefing via revert-on-receive contract

**Pre-conditions:** Distribution sends paymentToken atomically to all 10
ancestors during swap.
**Steps:**
1. Attacker registers a contract C that always reverts on `transfer(C)`.
2. Inserts C as ancestor in honest user's tree (sybil).
3. Honest user's swap reverts because distribution to C fails.

**Impact:** High — selective DoS on swaps that touch attacker subtree.
**Mitigation:** Distribution is **credit-only** to mapping (`pendingRewards
[C] += x`). No transfer during swap. Transfer only on user-initiated `claim`,
where the only griefable account is C itself.
**Test:** `test/referral/Distribute.t.sol::test_credit_does_not_call_external`.

---

## AS-10 — Token migration LP rug

**Pre-conditions:** LP tokens minted on graduation are sent to owner instead
of locked.
**Steps:**
1. Owner waits for graduation, receives LP.
2. Calls `removeLiquidity` on the AMM pair.
3. Drains paymentToken reserves.

**Impact:** Critical.
**Mitigation:** Migrator transfers LP to a hard-coded `LiquidityLocker` with
unlock timestamp ≥ now + 10y. LiquidityLocker is non-upgradeable, no admin
withdraw, only emits LP back to original owner after timestamp.
**Test:** `test/migration/Lock.t.sol::test_lp_locked_10y`.

---

## AS-11 — Read-only reentrancy on `pendingRewards`

**Pre-conditions:** External integrator (e.g., a vault) reads
`pendingRewards[user][token]` to compute share value mid-callback.
**Steps:**
1. User calls vault deposit; vault has `onTokenReceived` hook.
2. Hook reads `pendingRewards` while a `claim` tx is mid-execution and has
   already zeroed but not yet transferred.

**Impact:** Med — third-party integrator inconsistency.
**Mitigation:** Document atomic semantics; `claim` follows CEI so a hook
inside `claim` can only see "already credited 0".
**Test:** N/A (out of our scope; document for integrators).

---

## AS-12 — Initializer front-run on UUPS proxy

**Pre-conditions:** Implementation contract deployed but `initialize` not yet
called atomically with proxy creation.
**Steps:**
1. Attacker watches deploy script.
2. Calls `initialize(attackerOwner)` on the implementation directly,
   becoming owner of the impl (not the proxy, but a confusing artifact).

**Impact:** Low (impl is not proxy) but reputation/UI confusion.
**Mitigation:** `_disableInitializers()` in implementation constructor. Deploy
script uses `OpenZeppelin Foundry Upgrades` plugin which atomically deploys +
initializes.
**Test:** `test/upgrade/Initialize.t.sol::test_impl_initialize_disabled`.

---

## AS-13 — Fee-on-transfer payment token desync

**Pre-conditions:** Owner whitelists a fee-on-transfer token (e.g., SAFEMOON
clone) as paymentToken.
**Steps:**
1. User swaps 100 token in.
2. Curve receives 95 (5 % burn). Internal accounting credits 100.
3. After many swaps, accounting > balance → claims start reverting (insolvent).

**Impact:** High — protocol insolvency.
**Mitigation:**
- Whitelist allows only standard ERC20 (no transfer-tax, no rebase).
- Each `transferFrom` measured by `balanceBefore/balanceAfter`; only credited
  delta.
**Test:** `test/bonding/FeeOnTransfer.t.sol::test_fot_token_rejected`.

---

## Reference: invariant test command

```
forge test --match-path test/invariants/*.t.sol -vvv
forge fuzz --match-contract Invariant_ --runs 100000
```
