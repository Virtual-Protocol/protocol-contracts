# AgentFlow Launchpad — Threat Model (STRIDE)

**Scope:** `contracts/referral/`, `contracts/fun/Bonding.sol`, `contracts/fun/FRouter.sol`,
`contracts/launchpadv2/Bonding*.sol`, `contracts/Migrator.sol`, all upgrade hooks.

**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information disclosure,
Denial of service, Elevation of privilege). Each finding has Impact, Likelihood, and
Mitigation. Impact: Low / Med / High / Critical. Likelihood: Low / Med / High.

Trust model:
- `owner` — multisig (3-of-5 Gnosis Safe) for production deployments. Treated as honest
  but compromisable.
- `bondingOperator` / `migrator` role — service account with rotated key, lower trust.
- Any EOA / contract may register a referrer, swap on the curve, claim payouts.
- LP admin — multisig only; may rescue stuck non-protocol tokens.

---

## S — Spoofing

### S1. Forging another user's referrer link
- **Vector:** Attacker calls `referralRegistry.register(victim, attacker)` to plant
  themselves as referrer of `victim` before `victim` has registered.
- **Impact:** High — attacker steals all of victim's referral cashback forever.
- **Likelihood:** Med (front-running mempool registrations is trivial).
- **Mitigation:** Registration MUST be self-only (`msg.sender` is the registree) OR
  go through `register(referrer)` where caller binds themselves. `register(user, ref)`
  must be removed or restricted to owner with EIP-712 signed authorization from `user`.
  Lazy registration (first swap auto-binds with no overwrite) closes the window.

### S2. Forging swap origin to credit referral
- **Vector:** Use a malicious router to spoof `tx.origin` or pass arbitrary `address`
  into `swapWithReferrer(token, amountIn, referrer, recipient)` so credit goes to
  attacker's tree instead of caller's.
- **Impact:** Med — financial misdirection inside the same swap.
- **Likelihood:** Med.
- **Mitigation:** Always credit `msg.sender` as the swapper; never accept caller-supplied
  user address. Disallow `tx.origin` in any access path.

### S3. Owner identity spoofing on chain switch
- **Vector:** Deployer keeps the same `owner` constructor arg across Base/BSC; if one
  chain's owner key leaks, attacker poses on the other chain.
- **Impact:** Critical (owner privileges).
- **Likelihood:** Low.
- **Mitigation:** Use distinct multisigs per chain. Document chain → multisig mapping
  in `SCOPE.md`.

---

## T — Tampering

### T1. Modifying another user's pending referral balance
- **Vector:** `pendingRewards[user]` writable by anyone via miscoded internal function.
- **Impact:** Critical.
- **Likelihood:** Low (review surface is small).
- **Mitigation:** All writers internal/private; only `_credit(user, amount)` exposed
  to the bonding contract via a single onlyAuthorized path. Withdraw is pull-based
  (`claim()` reads `pendingRewards[msg.sender]` only).

### T2. Tampering with referrer tree post-registration
- **Vector:** Owner or anyone calls `setReferrer(user, newRef)` to re-route an existing
  user's payouts.
- **Impact:** High (silent redirect of cashback).
- **Likelihood:** Low (governance-only function).
- **Mitigation:** Tree is **immutable per-user once registered**. No `setReferrer`
  function. Owner cannot override. Document this immutability prominently.

### T3. Bonding curve reserve tampering
- **Vector:** A function (e.g. `sync`, `skim`, or a poorly guarded admin) modifies
  the virtual reserves so that `x * y` invariant breaks downward, letting attacker
  buy at stale price.
- **Impact:** Critical (drain).
- **Likelihood:** Low.
- **Mitigation:** No external setters on reserves; only `swap()` updates them and
  re-checks `K_after >= K_before`. `skim()` removed or restricted to non-tracked tokens.

### T4. Referral split percentages mutated mid-stream
- **Vector:** Owner front-runs a user's swap with `setReferralBps(higher_value)` and
  pockets a windfall.
- **Impact:** Med (governance griefing).
- **Likelihood:** Low.
- **Mitigation:** Bps changes time-locked (24h delay). Hard cap `MAX_REFERRAL_BPS = 3000`.

---

## R — Repudiation

### R1. Off-chain referral attribution disputes
- **Vector:** User claims they were the referrer but no on-chain proof exists.
- **Impact:** Med (support load, trust).
- **Likelihood:** High (will happen).
- **Mitigation:** Emit `Registered(user, referrer, depth, timestamp)` and `Credited(
  referrer, swapper, level, amount, token)` for every level credited. Indexer ingests
  events; UI shows tree from on-chain only.

### R2. Owner action without audit trail
- **Vector:** Owner pauses contract or rotates fee recipient silently.
- **Impact:** Med.
- **Likelihood:** Med.
- **Mitigation:** Every owner-only function emits an event with old/new value and
  caller. `Paused(by)`, `FeeRecipientUpdated(old, new)`, etc.

### R3. Migration / graduation events missing
- **Vector:** Token graduates from bonding curve to AMM; LP creation hidden.
- **Impact:** Med.
- **Likelihood:** Low.
- **Mitigation:** `Graduated(token, dexPair, liquidityToken, lockTimestamp)` emitted
  with all addresses.

---

## I — Information disclosure

### I1. Referral tree fully public
- **Vector:** `referrerOf(user)` public view; tree walkable.
- **Impact:** Low (this is by-design and a feature: transparency).
- **Likelihood:** Always.
- **Mitigation:** Treat as a feature. Document tree visibility in user-facing docs.
  Subgraph indexes the full tree. Users join knowing this.

### I2. Pending rewards as MEV signal
- **Vector:** Sophisticated user front-runs claims to influence price (small effect).
- **Impact:** Low.
- **Likelihood:** Low.
- **Mitigation:** Claims are stablecoin / paymentToken transfers — they don't move the
  curve. No mitigation needed.

### I3. Pre-graduation supply leaks via events
- **Vector:** Bots watch `Buy/Sell` events to predict graduation block, snipe.
- **Impact:** Low (this is normal launchpad UX).
- **Likelihood:** High.
- **Mitigation:** Time-lock graduation execution by N blocks once threshold hit, so
  no atomic threshold-cross-and-snipe.

---

## D — Denial of service

### D1. Gas grief on `claim()`
- **Vector:** Attacker registers a contract that reverts on token receive, gets
  credited, then claim path of upstream referrers reverts.
- **Impact:** High (frozen rewards).
- **Likelihood:** Med.
- **Mitigation:** Pull-based per-user claim (only the receiving address ever pays gas
  for its own claim, and a revert only blocks that address — not the parent or
  others). Use `transfer` with try/catch fallback to pendingRewards if non-EOA hostile.

### D2. Loop bomb on multi-level distribution
- **Vector:** 100-level deep tree triggers loop on every swap, gas exceeds block limit
  or makes swaps expensive enough that users avoid.
- **Impact:** High.
- **Likelihood:** Med (sybil farms can build deep trees).
- **Mitigation:** Hard cap depth at `MAX_REFERRAL_DEPTH = 10` for distribution
  purposes (deeper registrations allowed but unrewarded). Per-level credit O(1) via
  cached `referrerOf` chain — bounded loop.

### D3. `batchImport` gas DoS
- **Vector:** Owner calls `batchImport(huge_array)` and TX runs out of gas leaving
  partial state.
- **Impact:** Low (owner-only).
- **Likelihood:** Low.
- **Mitigation:** `batchImport` has a max length of 200 per call; documented chunking.

### D4. Unbounded pendingRewards token list
- **Vector:** Multiple paymentTokens supported → mapping `(user, token) → amount`.
  Attacker spams swaps with dust to pollute user's claim list.
- **Impact:** Med.
- **Likelihood:** Med.
- **Mitigation:** Whitelist of paymentTokens, owner-curated; only ~3 tokens supported.

### D5. Reentrancy lock starvation
- **Vector:** Single global `nonReentrant` lock blocks parallel ops.
- **Impact:** Low.
- **Likelihood:** Low.
- **Mitigation:** OpenZeppelin's `ReentrancyGuard` is per-function; not a real DoS.

---

## E — Elevation of privilege

### E1. Owner sets unlimited tax / fees
- **Vector:** Owner calls `setTaxBps(10_000)` (100%) — every swap fully extracted.
- **Impact:** Critical.
- **Likelihood:** Med (compromised key).
- **Mitigation:** Hard-coded `MAX_TAX_BPS = 1000` (10%). Setter rejects values >.

### E2. Owner upgrades to malicious implementation (UUPS)
- **Vector:** Upgradeable proxy + owner = owner can swap impl to drainer.
- **Impact:** Critical.
- **Likelihood:** Low (multisig).
- **Mitigation:**
  - Multisig 3-of-5 with hardware wallets.
  - 48h timelock between propose and execute upgrade.
  - Public announcement channel.
  - `_authorizeUpgrade` audited.

### E3. Owner drains ETH / tokens via `rescueToken`
- **Vector:** `rescueToken(any, any)` exists "to recover stuck assets".
- **Impact:** Critical.
- **Likelihood:** Med.
- **Mitigation:** Rescue function MUST blacklist protocol tokens (`paymentToken`,
  bonding curve LP, registered tokens). Only "stranger" tokens recoverable.

### E4. Privileged role inflation
- **Vector:** `addOperator` adds many EOAs; one is compromised.
- **Impact:** High.
- **Likelihood:** Med.
- **Mitigation:** Single `bondingOperator` slot, not a set. Rotation via timelock.

### E5. Bonding contract authorized to call `credit` on registry
- **Vector:** If any other contract is granted authorized status, it can mint
  pendingRewards arbitrarily.
- **Impact:** Critical.
- **Likelihood:** Low.
- **Mitigation:** `authorizedCrediter` is a single address, set once at deploy,
  immutable. Or guarded by 7-day timelock.

---

## Summary table

| ID | Threat | Impact | Likelihood | Status |
|----|--------|--------|-----------|--------|
| S1 | Forge victim's referrer | High | Med | Mitigated (lazy bind) |
| S2 | Forge swap origin | Med | Med | Mitigated (msg.sender) |
| S3 | Cross-chain owner reuse | Critical | Low | Operational |
| T1 | Mutate ref balance | Critical | Low | Mitigated |
| T2 | Re-route tree | High | Low | Mitigated (immutable) |
| T3 | Reserve tampering | Critical | Low | Mitigated (K-check) |
| T4 | Bps front-run | Med | Low | Mitigated (timelock+cap) |
| R1 | Attribution dispute | Med | High | Mitigated (events) |
| R2 | Owner silent action | Med | Med | Mitigated (events) |
| R3 | Migration silent | Med | Low | Mitigated |
| I1 | Tree visible | Low | Always | By design |
| I2 | Pending as MEV | Low | Low | N/A |
| I3 | Graduation snipe | Low | High | Mitigated (delay) |
| D1 | Claim revert | High | Med | Mitigated (pull) |
| D2 | Deep tree loop | High | Med | Mitigated (depth cap) |
| D3 | batchImport DoS | Low | Low | Mitigated (chunk) |
| D4 | Token list spam | Med | Med | Mitigated (whitelist) |
| D5 | Lock starvation | Low | Low | N/A |
| E1 | Tax = 100% | Critical | Med | Mitigated (hard cap) |
| E2 | Malicious upgrade | Critical | Low | Mitigated (timelock) |
| E3 | rescueToken drain | Critical | Med | Mitigated (blacklist) |
| E4 | Operator inflation | High | Med | Mitigated (single slot) |
| E5 | Authorized crediter abuse | Critical | Low | Mitigated (immutable) |
