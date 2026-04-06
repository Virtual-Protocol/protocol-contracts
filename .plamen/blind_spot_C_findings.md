# Blind Spot C Findings: Role Lifecycle, Capability Exposure, Function Reachability

---

## CHECK 6: Role Lifecycle Completeness

### Enumeration

1. **EXECUTOR_ROLE** — FRouterV2.sol, FRouterV3.sol
2. **ADMIN_ROLE** — FRouterV2.sol, FRouterV3.sol, FFactoryV2.sol, FFactoryV3.sol
3. **DEFAULT_ADMIN_ROLE** — FRouterV2.sol, FRouterV3.sol, FFactoryV2.sol, FFactoryV3.sol
4. **CREATOR_ROLE** — FFactoryV2.sol, FFactoryV3.sol
5. **privilegedLauncher** — BondingConfig.sol (`isPrivilegedLauncher` mapping)
6. **BondingV5 owner** — OwnableUpgradeable; BondingConfig.sol owner — OwnableUpgradeable
7. **Multicall3 owner** — manual `owner` variable

### Role Lifecycle Table

| Role | Grant Function | Revoke Function | Revoke Exists? | Circular Dependency? | Finding? |
|------|--------------|-----------------|----------------|---------------------|----------|
| EXECUTOR_ROLE (FRouterV2/V3) | DEFAULT_ADMIN_ROLE via inherited `grantRole()` | DEFAULT_ADMIN_ROLE via inherited `revokeRole()` | YES (inherited OZ) | NO circular dep — DEFAULT_ADMIN can always revoke | None beyond AC-10 |
| ADMIN_ROLE (FRouterV2/V3/FFactoryV2/V3) | DEFAULT_ADMIN_ROLE via `grantRole()` | DEFAULT_ADMIN_ROLE via `revokeRole()` | YES (inherited OZ) | NO | None — but note ADMIN_ROLE never granted at init (PC1-10 covers FFactory) |
| DEFAULT_ADMIN_ROLE | Self-granted at `initialize()` (to deployer) | Via inherited `revokeRole()` only | YES (inherited) | YES — see finding below | **BLIND-C1** |
| CREATOR_ROLE | DEFAULT_ADMIN_ROLE via `grantRole()` | DEFAULT_ADMIN_ROLE via `revokeRole()` | YES | NO | None (coverage: PC1-10) |
| privilegedLauncher | `BondingConfig.setPrivilegedLauncher(addr, true)` — onlyOwner | `BondingConfig.setPrivilegedLauncher(addr, false)` — onlyOwner | YES — `allowed_=false` | NO | None — fully revocable |
| BondingV5 owner | `initialize()` → `__Ownable_init(msg.sender)` | `renounceOwnership()` (inherited, permanent) | YES (but destructive) | NO | **BLIND-C2** |
| BondingConfig owner | `initialize()` → `__Ownable_init(msg.sender)` | `renounceOwnership()` (inherited, permanent) | YES (but destructive) | NO | **BLIND-C2** |
| Multicall3 owner | `constructor()` → `owner = msg.sender` | `transferOwnership()` only — NO zero-check-free revoke, NO renounce | NO `renounce` function | NO | **BLIND-C3** |

### DONE: 7 roles processed.

**Coverage Gate: CHECK 6 complete.**

---

## CHECK 7: Inherited Capability Exposure Gaps

### Enumeration

Base contracts to audit:
1. AccessControlUpgradeable (FRouterV2, FRouterV3, FFactoryV2, FFactoryV3)
2. OwnableUpgradeable (BondingV2, V3, V4, V5, BondingConfig)
3. UUPSUpgradeable — NOT inherited by any in-scope contract (verified: no import of UUPSUpgradeable in launchpadv2/*.sol; no `_authorizeUpgrade` override found)
4. PausableUpgradeable — NOT inherited by any in-scope contract (verified: no Pausable import or usage)
5. ReentrancyGuardUpgradeable (FRouterV2, FRouterV3, FFactoryV2, FFactoryV3, BondingV2-V5)

### Inherited Capability Gap Table

| Base Contract | Internal/Inherited Function | Exposed to External? | Gap? |
|--------------|---------------------------|---------------------|------|
| AccessControlUpgradeable | `grantRole(role, account)` public, callable by role admin | YES — accessible by DEFAULT_ADMIN_ROLE | No gap — expected behaviour |
| AccessControlUpgradeable | `revokeRole(role, account)` public, callable by role admin | YES — accessible by DEFAULT_ADMIN_ROLE | No gap |
| AccessControlUpgradeable | `renounceRole(role, callerConfirmation)` public, self-only | YES — any role holder can self-renounce | **BLIND-C4** — role holder can self-renounce; EXECUTOR_ROLE beOpsWallet can permanently remove itself |
| OwnableUpgradeable | `transferOwnership(address)` public onlyOwner | YES | No gap — expected |
| OwnableUpgradeable | `renounceOwnership()` public onlyOwner | YES — owner can permanently burn ownership | **BLIND-C2** — BondingV5/BondingConfig irrevocably lose admin control |
| UUPSUpgradeable | `_authorizeUpgrade()` | NOT PRESENT — none of these contracts are upgradeable via UUPS | No gap — confirmed safe |
| PausableUpgradeable | `pause()` / `unpause()` | NOT PRESENT — no Pausable inheritance | N/A |
| FPairV2 `approval()` | Called externally by any router with `onlyRouter` | Pair's `router` is set at construction and immutable | **BLIND-C5** — `router` field in FPairV2 is set at construction and NEVER changeable; if router is replaced (via `setRouter()` in FFactory), all existing pairs still point to the old router, creating a permanent divergence |

### DONE: All base contracts enumerated.

**Coverage Gate: CHECK 7 complete.**

---

## CHECK 8: Function Reachability Audit

### Enumeration

1. BondingV2.buy() / BondingV2.sell()
2. BondingV3.preLaunch() / BondingV4.preLaunch()
3. BondingV2.preLaunchProject60days()
4. FPairV2.graduate() — does not exist (not on FPairV2)
5. FPairV2.syncAfterDrain() — onlyRouter
6. multicall3.sol aggregate functions
7. FRouterV2.graduate() / FRouterV3.graduate()
8. BondingV2-V4 admin setters

### Reachability Table

| Function | Contract | Requires | Reachable in Production? | Dead Code / Gap? |
|----------|---------|---------|--------------------------|-----------------|
| `buy(amountIn, token, amountOutMin, deadline)` | BondingV2 | none (public) — but internally calls `router.buy()` which requires EXECUTOR_ROLE on msg.sender (BondingV2 addr) | **Blocked** — BondingV2 holds no EXECUTOR_ROLE on FRouterV2; call reverts at router | **BLIND-C6** |
| `sell(amountIn, token, amountOutMin, deadline)` | BondingV2 | none (public) — internally calls `router.sell()` which requires EXECUTOR_ROLE | **Blocked** same reason | **BLIND-C6** |
| `buy()` / `sell()` | BondingV3 | Same pattern as V2 | **Blocked** same reason | **BLIND-C6** |
| `preLaunch(...)` | BondingV3, BondingV4 | none (public) — BUT first statement is `revert("Not implemented")` | ALWAYS REVERTS | Dead code; confusing API surface — **BLIND-C7** |
| `preLaunchProject60days()` | BondingV2 | none (public) | Reachable — V2 is still active (not deprecated) | No finding |
| `cancelLaunch(token)` | BondingV2, V3, V4 | `msg.sender == _token.creator` | Reachable — useful for legacy tokens still on those versions | No finding |
| `syncAfterDrain()` | FPairV2 | `onlyRouter` | Reachable only by current router | No finding (protected) |
| `aggregate(calls)` | multicall3 | `onlyOwnerOrAdmin` | Reachable by owner/admin | No finding beyond RS2-2 |
| `aggregate3Value(calls)` | multicall3 | `onlyOwnerOrAdmin` — payable | Reachable; sends ETH to arbitrary targets | Covered by RS2-2 partially; **BLIND-C8** — `aggregate3Value` can route ETH from the contract to arbitrary addresses without any target whitelist; multicall3 can receive ETH via payable aggregate, then drain via `aggregate3Value` |
| `priceALast()` / `priceBLast()` | FPairV2 | public view | Reachable — but divides by reserve; if reserve0==0 after drain, division-by-zero is possible | **BLIND-C8** already covers this partially |
| BondingV2-V4 `setTokenParams()`, `setLaunchParams()`, `setDeployParams()` | BondingV2/V3/V4 | onlyOwner | Reachable — still relevant because V2/V3/V4 have live tokens pending launch | No gap — intentional admin controls |
| FRouterV2 `setTaxManager()` / `setAntiSniperTaxManager()` | FRouterV2 | onlyRole(ADMIN_ROLE) — updates deprecated fields | Reachable; updates `taxManager` and `antiSniperTaxManager` (slots marked `// deprecated`) | No finding — storage is deprecated but writing it is harmless |
| BondingV4 `setXLauncher()` | BondingV4 | onlyOwner | Reachable — but BondingV4.preLaunch() always reverts; `isXLauncher` mapping is never consumed | Dead state write — **BLIND-C7** |

### DONE: 14 functions enumerated and processed.

**Coverage Gate: CHECK 8 complete.**

---

## Findings

---

## Finding [BLIND-C1]: DEFAULT_ADMIN_ROLE Can Grant Itself to Attacker, Cannot Self-Remove Without External Help

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A single entity) | ✗6(no stored external state)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single actor), R6:✓, R8:✗(single-step), R10:✓, R12:✓]
**Severity**: Medium
**Location**: FRouterV2.sol:72, FRouterV3.sol:79, FFactoryV2.sol:51, FFactoryV3.sol:59
**Description**: DEFAULT_ADMIN_ROLE is granted exclusively to the deployer (msg.sender) in each `initialize()` call. OZ `AccessControlUpgradeable` exposes `renounceRole(DEFAULT_ADMIN_ROLE, self)` — callable by the DEFAULT_ADMIN_ROLE holder themselves. If the DEFAULT_ADMIN_ROLE holder calls `renounceRole`, the role is permanently burned from that address. Because OZ's `getRoleAdmin(DEFAULT_ADMIN_ROLE)` returns `DEFAULT_ADMIN_ROLE` itself, no external entity can re-grant it — any future recovery requires a proxy upgrade. More critically, because `DEFAULT_ADMIN_ROLE` is the admin of `EXECUTOR_ROLE` and `ADMIN_ROLE`, burning the DEFAULT_ADMIN_ROLE means EXECUTOR_ROLE can never be revoked even if the beOpsWallet is compromised.
**Impact**: If the deployer EOA holding DEFAULT_ADMIN_ROLE is compromised and the attacker renounces the role after granting themselves EXECUTOR_ROLE, the protocol permanently loses the ability to revoke EXECUTOR_ROLE. Combined with AC-1 (EXECUTOR_ROLE can drain all pools), this creates an irrecoverable critical state. Impact at: FRouterV2 and FRouterV3 (all buys/sells/graduation permanently in attacker's hands), FFactoryV2/V3 (tax parameters permanently locked to attacker's settings).
**Evidence**:
```solidity
// OZ AccessControlUpgradeable — inherited by all 4 contracts
function renounceRole(bytes32 role, address callerConfirmation) public virtual {
    if (callerConfirmation != _msgSender()) { revert ... }
    _revokeRole(role, callerConfirmation);
}
// getRoleAdmin(DEFAULT_ADMIN_ROLE) == DEFAULT_ADMIN_ROLE
// After renounce: no one can call grantRole or revokeRole for any role
```

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: Protocol loses role management capability permanently; no recovery path short of proxy upgrade
**Postcondition Types**: [ACCESS]
**Who Benefits**: Attacker who compromised DEFAULT_ADMIN_ROLE EOA; can then renounce to lock in malicious EXECUTOR_ROLE

---

## Finding [BLIND-C2]: BondingV5 and BondingConfig renounceOwnership() Has No Recovery Path

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✗8(single-step)
**Rules Applied**: [R4:✗(evidence clear), R5:✗(single actor), R6:✗(no role), R8:✗(single-step), R10:✓, R13:✓]
**Severity**: Medium
**Location**: BondingV5.sol (OwnableUpgradeable base), BondingConfig.sol (OwnableUpgradeable base)
**Description**: Both `BondingV5` and `BondingConfig` inherit `OwnableUpgradeable`, which exposes the `renounceOwnership()` function callable by the current owner. If called, ownership is set to `address(0)`, permanently blocking all `onlyOwner` functions. For `BondingConfig`, this permanently prevents: `setDeployParams`, `setBondingCurveParams`, `setReserveSupplyParams`, `setCommonParams`, `setScheduledLaunchParams`, `setTeamTokenReservedWallet`, `setPrivilegedLauncher`. For `BondingV5`, it permanently prevents: `setBondingConfig`. Unlike AccessControl contracts which require `revokeRole` from a role admin, ownership loss in Ownable contracts has no recovery path without a proxy upgrade. Neither BondingV5 nor BondingConfig appear to use UUPS (no `_authorizeUpgrade` override found), so proxy upgradability is not confirmed. This finding was NOT covered by existing findings — the prior audit noted `renounceOwnership()` is available in multicall3, but did not analyze BondingV5/BondingConfig.
**Impact**: Accidental or malicious `renounceOwnership()` call permanently bricks all configuration updates to BondingConfig, freezing graduation thresholds, team wallet, and privileged launcher mapping at their last set values. For BondingV5, the active bonding config address cannot be updated if BondingConfig needs to be redeployed. This affects all future token launches but not already-launched tokens (their per-token config is frozen at preLaunch time).
**Evidence**:
```solidity
// BondingConfig.sol — OwnableUpgradeable inheritance
contract BondingConfig is Initializable, OwnableUpgradeable {
    function setPrivilegedLauncher(address launcher_, bool allowed_) external onlyOwner { ... }
    function setTeamTokenReservedWallet(address wallet_) external onlyOwner { ... }
    // 6 additional onlyOwner setters — all gated
}
// OwnableUpgradeable (inherited):
function renounceOwnership() public virtual onlyOwner {
    _transferOwnership(address(0)); // irrevocable
}
```

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: Owner set to address(0); all onlyOwner functions permanently inaccessible
**Postcondition Types**: [ACCESS]
**Who Benefits**: No party — purely destructive; mistaken call by ops wallet causes permanent DoS of admin functions

---

## Finding [BLIND-C3]: Multicall3 Has No renounceOwnership Mechanism — Ownership Transfer is One-Step, Irreversible

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✗8(single-step)
**Rules Applied**: [R4:✗(clear), R5:✗(single entity), R6:✗(no external role), R8:✗(single-step), R10:✓, R13:✓]
**Severity**: Low
**Location**: multicall3.sol:350-357
**Description**: PC1-3 (already catalogued) notes the lack of two-step ownership transfer. This finding focuses on a complementary gap: unlike OZ's Ownable, Multicall3 uses a custom `owner` variable with no `renounceOwnership()` function at all. This means ownership cannot be voluntarily burned if a compromise is detected and the team wants to freeze the contract pending an upgrade. The only option is to transfer ownership to `address(0)` directly (which `transferOwnership` blocks via `newOwner != address(0)` check at line 352). Effective immutability of owner combined with no revocation path means a compromised owner has unchecked and permanent approveToken/transferToken/withdrawETH capability. Note: This COMPLEMENTS PC1-3 (no two-step transfer) but is distinct — it is a missing emergency brake, not a transfer mistake risk.
**Impact**: If the `owner` EOA is compromised, there is no on-chain mechanism to freeze or revoke ownership. The attacker retains permanent access to `transferToken`, `withdrawETH`, `approveToken`, and `batchWithdrawERC20Tokens` until a new deployment supersedes the contract.
**Evidence**:
```solidity
function transferOwnership(address newOwner) public onlyOwner {
    require(newOwner != address(0), "Multicall3: new owner is the zero address");
    // No way to set owner = address(0) to freeze
    emit OwnershipTransferred(owner, newOwner);
    owner = newOwner;
}
// No renounceOwnership() function exists.
```

---

## Finding [BLIND-C4]: EXECUTOR_ROLE Holder Can Permanently Self-Remove via renounceRole(), Bricking All Trading

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✗8(single-step)
**Rules Applied**: [R4:✗(clear), R5:✗(single actor), R6:✓, R8:✗(single-step), R10:✓, R12:✓]
**Severity**: High
**Location**: FRouterV2.sol (EXECUTOR_ROLE), FRouterV3.sol (EXECUTOR_ROLE) — OZ AccessControlUpgradeable base
**Description**: `AccessControlUpgradeable.renounceRole(role, self)` is publicly callable by any role holder. The beOpsWallet EOA holding EXECUTOR_ROLE can call `renounceRole(EXECUTOR_ROLE, beOpsWallet)` on FRouterV2 or FRouterV3 at any time. This immediately removes itself from EXECUTOR_ROLE. The protocol explicitly documents that buy/sell/graduate/approval/addInitialLiquidity/drainPrivatePool/drainUniV2Pool are ALL gated by EXECUTOR_ROLE. Once renounced, no one can trade on the platform until DEFAULT_ADMIN_ROLE re-grants EXECUTOR_ROLE to a new address. The gap: **this is a self-serve, permanent action that doesn't require DEFAULT_ADMIN_ROLE involvement**, unlike revokeRole which only DEFAULT_ADMIN_ROLE can call. If the beOpsWallet is compromised, the attacker can choose to drain funds (via AC-1) OR deny service by renouncing the role — the second option is uncaught and permanent from a user perspective until remediated off-chain.

**Impact**: Any party controlling the EXECUTOR_ROLE EOA (including an attacker who stole the private key) can call `renounceRole` to permanently halt all trading operations on the protocol. This blocks buy, sell, graduate, addInitialLiquidity — effectively a complete DoS of all live pairs until DEFAULT_ADMIN_ROLE intervenes. If the DEFAULT_ADMIN_ROLE account has also been compromised (see BLIND-C1), there is no recovery path.
**Evidence**:
```solidity
// FRouterV2.sol:169, FRouterV3.sol:174 — every trading function:
function buy(...) public onlyRole(EXECUTOR_ROLE) nonReentrant { ... }
function sell(...) public onlyRole(EXECUTOR_ROLE) nonReentrant { ... }
function graduate(...) public onlyRole(EXECUTOR_ROLE) nonReentrant { ... }

// OZ AccessControlUpgradeable (inherited):
function renounceRole(bytes32 role, address callerConfirmation) public virtual {
    if (callerConfirmation != _msgSender()) revert ...;
    _revokeRole(role, callerConfirmation); // self-callable, no admin approval needed
}
```

### Precondition Analysis
**Missing Precondition**: Attacker must control the beOpsWallet EOA
**Precondition Type**: ACCESS
**Why This Blocks**: Requires key compromise; but combined with private key exposure (e.g., leaked key in CI/CD, compromised backend server) this becomes realistic — especially given the beOpsWallet is described as an operational EOA, not a hardware wallet.

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: EXECUTOR_ROLE is empty on FRouterV2/V3; all gated functions revert; DEFAULT_ADMIN_ROLE must re-grant the role
**Postcondition Types**: [ACCESS, STATE]
**Who Benefits**: Attacker attempting denial-of-service; or griefing by disgruntled insider

---

## Finding [BLIND-C5]: FPairV2.router Is Immutable After Construction — setRouter() in FFactory Breaks All Existing Pairs

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✗6(no role check gap) | ✗8(stored external state) — R8 applicable
**Rules Applied**: [R4:✗(clear), R5:✗(single entity), R6:✗(no role), R8:✓, R10:✓, R14:✓]
**Severity**: Medium
**Location**: FPairV2.sol:13,29-46 (constructor sets `router`), FFactoryV2.sol:124-126, FFactoryV3.sol:132-134 (`setRouter()`)
**Description**: When a new pair is created via `FFactory._createPair()`, the `FPairV2` constructor stores the current `factory.router` address immutably: `router = router_`. There is no `setRouter()` function on `FPairV2`. All `onlyRouter` functions (`mint`, `swap`, `approval`, `transferAsset`, `transferTo`, `syncAfterDrain`, `resetTime`, `setTaxStartTime`) are permanently gated to the address set at construction time. When `FFactoryV2.setRouter()` or `FFactoryV3.setRouter()` is called to update the router (e.g., upgrading from FRouterV2 to a patched version), all **existing pairs** continue to require the old router. New pairs will use the new router. The result: an admin who sets a new router cannot operate on existing pairs via the new router. They must either retain the old router EOA privileges indefinitely, or all existing pairs become permanently unserviceable.
**Impact**: Any router upgrade (e.g., patching AC-1, AC-2, EC-1, EC-3) creates a split: new pairs use patched router, old pairs use vulnerable router. The vulnerable router cannot be decommissioned without breaking all existing pairs. This design flaw means security patches to the router do not apply to already-deployed pairs. This affects FFactoryV2 (BondingV2/V3/V4 ecosystem) and FFactoryV3 (BondingV5 ecosystem) identically.
**Evidence**:
```solidity
// FPairV2.sol:29-46
constructor(address router_, ...) {
    router = router_; // stored permanently; no setRouter()
}
modifier onlyRouter() {
    require(router == msg.sender, "Only router can call this function");
}

// FFactoryV2.sol:124-126
function setRouter(address router_) public onlyRole(ADMIN_ROLE) {
    router = router_; // updates factory's router for FUTURE pairs only
}
// _createPair passes factory.router at time of creation:
FPairV2 pair_ = new FPairV2(router, tokenA, tokenB, ...); // old router baked in
```

### Postcondition Analysis (CONFIRMED)
**Postconditions Created**: Router upgrade creates a permanently split state — old pairs unusable by new router
**Postcondition Types**: [STATE, ACCESS]
**Who Benefits**: No one — purely a design constraint that reduces the effectiveness of any security remediation

---

## Finding [BLIND-C6]: BondingV2/V3 buy() and sell() Are Unreachable in Production — EXECUTOR_ROLE Guard Blocks All Users

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✗6(no external role)
**Rules Applied**: [R4:✗(clear), R5:✗(single actor), R6:✗(no role in pair), R8:✗(single-step), R10:✓, R13:✓]
**Severity**: Medium
**Location**: BondingV2.sol:495-603 (`sell`, `buy`), BondingV3.sol (`sell`, `buy`) — indirectly FRouterV2.sol:131,169
**Description**: `BondingV2.buy()` and `BondingV2.sell()` are declared `public` with no access modifier, appearing accessible to all users. However, both internally call `router.buy(amountIn, tokenAddress, msg.sender, ...)` and `router.sell(amountIn, tokenAddress, msg.sender)` respectively, where `router` is `FRouterV2`. `FRouterV2.buy()` and `FRouterV2.sell()` are gated by `onlyRole(EXECUTOR_ROLE)`. When a regular user calls `BondingV2.buy()`, the call reaches `FRouterV2.buy()` with `msg.sender = BondingV2 contract address` — not the user. Since BondingV2 is not granted EXECUTOR_ROLE on FRouterV2, the call reverts with "AccessControl: account ... is missing role ...". The BondingV2 and BondingV3 contracts appear to be legacy versions where buy/sell were previously permissionless (routed through a public router) but after the EXECUTOR_ROLE was added to FRouterV2, user-facing access was silently broken. The same issue applies to BondingV3. (BondingV4 already has `preLaunch` reverting with "Not implemented", suggesting it was deliberately deprecated.)

**Impact**: Any user attempting to buy or sell tokens on BondingV2/BondingV3 pairs via the public `buy()`/`sell()` entrypoints on the Bonding contracts will have their transactions revert. This creates a situation where:
1. Tokens launched via BondingV2 that have not yet graduated are permanently unserviceable unless the BondingV2/V3 contract address is granted EXECUTOR_ROLE — which would allow BondingV2 to call all other EXECUTOR_ROLE-gated functions including `graduate()` and `approval()`.
2. Alternatively, there is no user-facing buy/sell path for legacy tokens.
**Evidence**:
```solidity
// BondingV2.sol:555 (_buy internal function)
(uint256 amount1In, uint256 amount0Out) = router.buy(
    amountIn, tokenAddress, buyer, isInitialPurchase
); // msg.sender to FRouterV2 is BondingV2 address

// FRouterV2.sol:174
function buy(...) public onlyRole(EXECUTOR_ROLE) nonReentrant { ... }
// BondingV2 has no EXECUTOR_ROLE — reverts every time
```

---

## Finding [BLIND-C7]: BondingV3/V4 preLaunch() Always Reverts and BondingV4 Setter State is Consumed by Dead Code

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✗6(no role) | ✗8(N/A)
**Rules Applied**: [R4:✗(clear), R5:✗(single entity), R6:✗(no role), R8:✗(N/A), R10:✓, R13:✓]
**Severity**: Low
**Location**: BondingV3.sol:195-205, BondingV4.sol:247-258, BondingV4.sol:234-236 (`setXLauncher`)
**Description**: `BondingV3.preLaunch()` and `BondingV4.preLaunch()` both begin with `revert("Not implemented")` as their first statement. All code following this revert is unreachable dead code. BondingV4 additionally exposes `setXLauncher(address, bool)` which writes to the `isXLauncher` mapping — but this mapping is only consumed inside `BondingV4.preLaunch()` which always reverts. Therefore, `setXLauncher` modifies state that has zero observable effect. Both patterns create API surface confusion: callers may attempt to use these functions assuming they are live, leading to silent DoS (from a user perspective, the function exists but always fails).
**Impact**: (1) Any integrator or frontend relying on `BondingV3.preLaunch()` or `BondingV4.preLaunch()` will receive a hard revert with an opaque reason. (2) BondingV4 owner/admin calling `setXLauncher()` wastes gas writing state that is never read. (3) The dead code in both `preLaunch()` functions contains logic that appears valid (access control, token creation) but is permanently bypassed — if the `revert` is ever removed in a future upgrade, the dead code could re-activate with potentially inconsistent invariants compared to the current BondingV5 implementation.
**Evidence**:
```solidity
// BondingV3.sol:195-205
function preLaunch(...) public nonReentrant returns (address, address, uint, uint256) {
    revert("Not implemented"); // ALL code below is dead
    if (purchaseAmount < fee || cores.length <= 0) { revert InvalidInput(); }
    ...
}

// BondingV4.sol:234-236
function setXLauncher(address launcher, bool allowed) public onlyOwner {
    isXLauncher[launcher] = allowed; // consumed only in dead preLaunch
}
```

---

## Finding [BLIND-C8]: multicall3 aggregate3Value() Routes ETH to Arbitrary Targets Without Whitelist — Admin/Owner Can Drain Contract ETH

**Verdict**: CONFIRMED
**Step Execution**: ✓1,2,3,5 | ✗4(N/A) | ✗11(no external token transfer risk specific to this)
**Rules Applied**: [R4:✗(clear), R5:✗(single entity), R6:✓, R8:✗(single-step), R10:✓, R12:✓]
**Severity**: Medium
**Location**: multicall3.sol:202-228 (`aggregate3Value`), multicall3.sol:524-528 (`receive()`/`fallback()`)
**Description**: `Multicall3.aggregate3Value()` is marked `public payable onlyOwnerOrAdmin` and accepts an array of `Call3Value` structs, each containing an arbitrary `target` address, `value` (ETH amount), and `callData`. The function forwards ETH from `msg.value` AND any ETH already held in the contract to arbitrary targets in a single call. The contract has `receive() external payable` and `fallback() external payable`, so it can accumulate ETH from payable aggregate calls (where `msg.value` is collected but calls fail, leaving ETH stranded). Any admin can then call `aggregate3Value` to route this accumulated ETH to an arbitrary address. This bypasses the `withdrawETH(address, uint)` function which at least makes the withdrawal explicit. The `aggregate3Value` path allows ETH extraction disguised as "legitimate batch calls." Note: RS2-2 partially covered batch function silent failures for admins; this finding addresses a distinct ETH-routing vector via `aggregate3Value`.
**Impact**: An admin (not just owner) can drain any ETH accumulated in the multicall3 contract by crafting `aggregate3Value` calls with `value` fields routing ETH to an attacker-controlled address. Since `aggregate3` and `aggregate3Value` use `allowFailure` per-call, failures can be suppressed, making the drain difficult to detect from transaction logs alone.
**Evidence**:
```solidity
// multicall3.sol:202-228
function aggregate3Value(Call3Value[] calldata calls)
    public payable onlyOwnerOrAdmin
    returns (Result[] memory returnData)
{
    ...
    for (...) {
        // Sends this.value (from msg.value + balance) to arbitrary calli.target
        (result.success, result.returnData) = calli.target.call{value: calli.value}(calli.callData);
        // if allowFailure=true: drain is silently swallowed
    }
}
receive() external payable {} // ETH accumulates here
```

---

## Chain Summary

| Finding ID | Location | Root Cause (1-line) | Verdict | Severity | Precondition Type | Postcondition Type |
|-----------|----------|---------------------|---------|----------|-------------------|--------------------|
| BLIND-C1 | FRouterV2/V3.sol, FFactoryV2/V3.sol (OZ AccessControl base) | DEFAULT_ADMIN_ROLE holder can self-renounce via `renounceRole()`, permanently burning role management | CONFIRMED | Medium | KEY_COMPROMISE | PERMANENT_ROLE_LOSS |
| BLIND-C2 | BondingV5.sol, BondingConfig.sol (OZ OwnableUpgradeable base) | `renounceOwnership()` permanently removes admin control from BondingV5/BondingConfig with no recovery path | CONFIRMED | Medium | OPERATIONAL_ERROR | PERMANENT_DOS_ADMIN |
| BLIND-C3 | multicall3.sol:350-357 | No `renounceOwnership()` means a compromised owner can never be frozen; no emergency brake exists | CONFIRMED | Low | KEY_COMPROMISE | PERSISTENT_DRAIN_CAPABILITY |
| BLIND-C4 | FRouterV2.sol, FRouterV3.sol (OZ AccessControl base) | EXECUTOR_ROLE holder can self-revoke via `renounceRole()` without DEFAULT_ADMIN_ROLE intervention, halting all trading | CONFIRMED | High | KEY_COMPROMISE | TRADING_DOS |
| BLIND-C5 | FPairV2.sol:13, FFactoryV2.sol:124, FFactoryV3.sol:132 | FPairV2.router is immutable post-construction; factory setRouter() only affects new pairs, making router upgrades non-retroactive | CONFIRMED | Medium | STATE | SPLIT_ROUTER_STATE |
| BLIND-C6 | BondingV2.sol:495,585, BondingV3.sol (buy/sell) | Public buy()/sell() internally call FRouterV2.buy()/sell() which require EXECUTOR_ROLE — BondingV2/V3 never holds this role, so all user trades revert | CONFIRMED | Medium | MISSING_ROLE_GRANT | PERMANENT_TRADING_DOS |
| BLIND-C7 | BondingV3.sol:195, BondingV4.sol:247,234 | preLaunch() in V3/V4 always reverts; BondingV4.setXLauncher() writes state consumed only by dead code | CONFIRMED | Low | DESIGN | DEAD_STATE |
| BLIND-C8 | multicall3.sol:202-228 | aggregate3Value() routes ETH to arbitrary targets without whitelist; admin can drain accumulated ETH via batch call | CONFIRMED | Medium | ROLE_ABUSE | ETH_DRAIN |
