# Per-contract Compliance Checklist

For each in-scope contract, every box must be checked before audit handoff.
A `[ ]` is a blocker.

---

## Common (applies to ALL contracts)

- [ ] License identifier `// SPDX-License-Identifier: MIT` (or BUSL where chosen)
- [ ] Pragma pinned: `pragma solidity 0.8.26;` (no `^`)
- [ ] OpenZeppelin imports use exact version `@openzeppelin/contracts@5.x.x`
- [ ] No `tx.origin` anywhere except for explicit refund-self patterns
- [ ] No external `delegatecall` to user-controlled addresses
- [ ] No `selfdestruct`
- [ ] No `block.timestamp` used as randomness source
- [ ] No floating point / fixed-point misuse; all bps math uses `* X / 10000`
- [ ] Custom errors instead of `require(string)` everywhere (gas + clarity)
- [ ] Every `external` state-changing function: `nonReentrant`
- [ ] Every `external` state-changing function: emits an event
- [ ] Every owner-only function: `onlyOwner` or role-based access
- [ ] `Ownable2Step` (not plain `Ownable`)
- [ ] `_disableInitializers()` in constructor (if upgradeable)
- [ ] `pause()` / `unpause()` exposed; `whenNotPaused` on user paths
- [ ] No infinite-approval pattern internally
- [ ] All `transferFrom` uses `SafeERC20.safeTransferFrom`
- [ ] All `transfer` uses `SafeERC20.safeTransfer`
- [ ] `unchecked` blocks only when overflow proven impossible (commented why)
- [ ] All public/external functions have NatSpec
- [ ] No magic numbers — named `constant` / `immutable`
- [ ] All loops bounded by a constant or input-length (with input length cap)
- [ ] No assembly (or assembly justified + audited per-block)
- [ ] No `ecrecover` without `s ≤ secp256k1n/2` malleability check
- [ ] Slither clean (no HIGH / CRITICAL)
- [ ] Coverage ≥ 95 % line, 100 % branch

---

## ReferralRegistry.sol

- [ ] `register(address referrer)` only — no `register(user, ref)` API
- [ ] `referrer == msg.sender` reverts (`SelfReferralForbidden`)
- [ ] `referrerOf[msg.sender] != address(0)` reverts (`AlreadyRegistered`)
- [ ] Cycle prevention: walks up `referrerOf[ref]` for `MAX_REFERRAL_DEPTH`
      and reverts on `msg.sender` match
- [ ] Emits `Registered(user, referrer, depth, timestamp)`
- [ ] No `setReferrer`, `unregister`, or `transferOwnership`-like remapping
- [ ] `batchImport` (if present) is `onlyOwner`, max length 200, validates
      cycles per pair
- [ ] `referrerOf(user)` is `external view`
- [ ] `getAncestors(user, n)` returns up to `n` (capped at `MAX_REFERRAL_DEPTH`)
- [ ] No state mutation in view functions

---

## ReferralPayouts.sol

- [ ] `_credit(user, token, amount)` is internal; only callable via authorized
      bonding contract
- [ ] `authorizedCrediter` is single immutable address (or guarded by
      timelock if mutable)
- [ ] `claim(token)` follows checks-effects-interactions:
      1. read pending
      2. zero pending
      3. transfer
- [ ] `claim` is `nonReentrant` and `whenNotPaused`
- [ ] PaymentToken transfer uses `safeTransfer`
- [ ] Distribution loop iterates ≤ `MAX_REFERRAL_DEPTH` (10) regardless of
      tree depth
- [ ] Per-level bps from `levelBps[level]`; sum ≤ 10000
- [ ] `setLevelBps` reverts if sum > 10000
- [ ] `setLevelBps` is owner-only and timelocked (48h)
- [ ] `MAX_REFERRAL_BPS` cap enforced (e.g. 3000)
- [ ] Emits `Credited(referrer, swapper, level, token, amount)` per level
- [ ] Emits `Claimed(user, token, amount)`
- [ ] No way to transfer pendingRewards between users
- [ ] No way for owner to zero a user's pending without payout
- [ ] `rescueToken(token, to)` blacklists all whitelisted paymentTokens

---

## Bonding.sol (and BondingV5.sol)

- [ ] `swap` checks `K_after >= K_before` after fee
- [ ] `taxBps[token] ≤ MAX_TAX_BPS (1000)` enforced in `setTaxBps`
- [ ] Per-tx max buy enforced (default 2 % supply or configurable)
- [ ] Slippage param `minAmountOut` honored on every swap path
- [ ] `launch` mints exactly `INITIAL_SUPPLY`; no other mint path
- [ ] Curve cannot be swapped after `graduated[token] == true`
- [ ] Graduation is two-phase (threshold → pending → execute after N blocks)
- [ ] Graduation calls `Migrator.graduate` exactly once per token
- [ ] Fee split: protocolFee + refFee + LP — sum is exact, no rounding loss
- [ ] PaymentToken whitelist enforced on `launch` (no fee-on-transfer)
- [ ] Fee-on-transfer detection: `balanceBefore` / `balanceAfter` deltas used
- [ ] Emits `TokenLaunched`, `Buy`, `Sell`, `Graduated`, `FeeAccrued`
- [ ] Pause halts `swap` and `launch` but not `claim` (delegated to payouts)
- [ ] Reserve sync: no public `skim` / `sync` that could destabilize K

---

## FRouter.sol

- [ ] Non-upgradeable (immutable bytecode)
- [ ] `swap(tokenIn, tokenOut, amountIn, minOut, recipient)` honors slippage
- [ ] No `arbitrary-from-in-transferFrom` (each `transferFrom` uses
      `msg.sender` as `from`)
- [ ] Excess paymentToken refunded to caller
- [ ] No infinite approvals stored
- [ ] `swapWithReferrer` validates referrer ≠ msg.sender (or no-op if same)
- [ ] Deadline parameter respected (`block.timestamp <= deadline`)

---

## FERC20.sol

- [ ] Minted only by Bonding at launch
- [ ] No additional mint path
- [ ] Standard OZ ERC20Permit (no custom transfer logic)
- [ ] Transfer to AMM pair allowed only after graduation
- [ ] No transfer tax / no fee-on-transfer

---

## Migrator.sol

- [ ] `graduate(token)` callable only by Bonding
- [ ] Computes treasury / LP / airdrop allocations; sums == totalSupply
- [ ] Creates AMM pair (Pancake V2) atomically
- [ ] Adds liquidity using exact reserves from curve
- [ ] LP tokens transferred to `LiquidityLocker` with 10y unlock
- [ ] No path to remove liquidity from Migrator/Locker before unlock
- [ ] Emits `Graduated(token, dexPair, lpAmount, lockUntil)`

---

## LiquidityLocker.sol (referenced; may live separately)

- [ ] Non-upgradeable
- [ ] `deposit(lpToken, amount, unlockAt, beneficiary)` — anyone can deposit
- [ ] `withdraw(lpToken, beneficiary)` — only after `unlockAt`
- [ ] No admin / owner withdraw path
- [ ] Beneficiary cannot be changed post-deposit
- [ ] Emits `Locked`, `Unlocked`

---

## Cross-cutting tests required

- [ ] Foundry invariant `Inv_PayoutsLeFees`
- [ ] Foundry invariant `Inv_TreeAcyclic`
- [ ] Foundry invariant `Inv_KAfterSwap`
- [ ] Foundry invariant `Inv_NoFreeMint`
- [ ] Reentrancy unit test for every external state-changing function
- [ ] Sandwich-on-graduation test
- [ ] Sybil chain depth-cap test
- [ ] Owner-tax-cap test
- [ ] Cyclic batchImport rejection test

---

## Pre-handoff sign-off

Before sending to auditor:

- [ ] All boxes above checked
- [ ] `git tag audit-2026-04` pushed
- [ ] `deployments/bsc-testnet.json` populated and addresses verified
- [ ] `audit-output/` bundle uploaded to shared drive
- [ ] Walkthrough video (~ 20 min) recorded explaining architecture
- [ ] Q&A Slack channel created and shared
