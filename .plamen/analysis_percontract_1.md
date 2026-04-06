# Per-Contract Analysis — Phase 3c
**Agent:** Per-Contract Analysis Agent  
**Date:** 2026-04-02  
**Scope:** Cluster 1 (multicall3.sol) + Cluster 2 (FFactoryV2.sol, FFactoryV3.sol)  
**Finding IDs:** PC1-1 through PC1-17

---

## Cluster 1: multicall3.sol

### [PC1-1] SEVERITY: HIGH — batchTransferTokens() calls onlyOwner-gated transferToken() from onlyOwnerOrAdmin context (privilege escalation via call chain)

**File:** `contracts/launchpadv2/multicall3.sol:446-459` and `428-440`

`batchTransferTokens()` is guarded by `onlyOwnerOrAdmin` (line 450), but it internally calls `transferToken()` which is guarded by `onlyOwner` (line 432). Since `batchTransferTokens` is the caller and `msg.sender` inside `transferToken()` is still the original external caller (not the contract itself — these are internal Solidity calls, not `.call()`), the inner `onlyOwner` check executes against the original `msg.sender`.

**Result:** An admin (who has `onlyOwnerOrAdmin` permission) calling `batchTransferTokens()` will hit the `onlyOwner` require inside `transferToken()` and revert. The batch function is unusable for admins; only the owner can invoke it successfully.

This is the deeper consequence of RS2-2 (which noted the pattern for aggregate-style functions). Here, `batchTransferTokens` is *explicitly designed* to let admins do batch transfers, but silently delegates to an `onlyOwner`-only function, making the admin grant for `batchTransferTokens` a dead letter. Any admin who was delegated batch-transfer capability has zero actual power.

```solidity
// multicall3.sol:446-459
function batchTransferTokens(...) public onlyOwnerOrAdmin {   // admin allowed here
    for (uint256 i = 0; i < tokens.length; i++) {
        transferToken(tokens[i], recipients[i], amounts[i]);   // <-- calls onlyOwner gated fn
    }
}

// multicall3.sol:428-432
function transferToken(...) public onlyOwner {                 // admin blocked here
    ...
```

**Same pattern:** `batchWithdrawERC20Tokens()` (line 494, `onlyOwnerOrAdmin`) calls `withdrawERC20Token()` (line 472, `onlyOwner`). Same broken delegation. Any admin calling `batchWithdrawERC20Tokens` will always revert.

**Impact:** Admin role for token withdrawal/transfer is entirely non-functional; admin cannot execute any batch token operation.

---

### [PC1-2] SEVERITY: MEDIUM — aggregate3Value() ETH forwarded before accounting check (TOCTOU / partial-forward griefing)

**File:** `contracts/launchpadv2/multicall3.sol:239-291`

The ETH accounting check (`require(msg.value == valAccumulator, "Multicall3: value mismatch")`) is placed **after** all calls have been made (line 290). Each call at line 255 forwards ETH immediately:

```solidity
(result.success, result.returnData) = calli.target.call{value: val}(calli.callData);
// ...
unchecked { valAccumulator += val; }
```

If an individual call succeeds but later the `valAccumulator` doesn't equal `msg.value`, the entire tx reverts — but all ETH has already been sent out as part of those calls. The EVM will unwind those transfers on revert, so in practice there is no permanent loss. **However**, note that this is already flagged as RS2-5 in the exclusion list. Going deeper:

**Deeper issue:** The `unchecked { valAccumulator += val; }` block wraps only the accumulation, while the actual `.call{value: val}` is outside the unchecked block. However, if a call's `allowFailure = true` and it reverts, the ETH for that call is returned by the EVM, but `valAccumulator` still includes `val`. If all calls with `allowFailure=false` pass but one with `allowFailure=true` reverts mid-call while holding ETH, the subsequent `require(msg.value == valAccumulator)` may still pass (valAccumulator correctly accumulated) even though the failed call received 0 ETH back into the contract. The contract will end up with the reverted-call's ETH stuck inside it — since the failed call returns ETH to the Multicall3 contract, and no withdrawal is triggered.

**Stuck ETH scenario:** `calls = [{target: A, value: 5 ETH, allowFailure: true}, ...]` — if call to A reverts, A receives 0 ETH, but the 5 ETH stays in Multicall3. The tx completes. `valAccumulator` equals `msg.value`. The 5 ETH is now trapped in the contract and can only be rescued via `withdrawETH` (owner only).

---

### [PC1-3] SEVERITY: MEDIUM — No renounceOwnership protection; owner can be set to address(0) via transferOwnership bypass

**File:** `contracts/launchpadv2/multicall3.sol:350-357`

`transferOwnership()` guards against `newOwner == address(0)` (line 352-354). However, the contract does NOT inherit from OpenZeppelin `Ownable` and has no `renounceOwnership()` function. So the only way to get owner=0 is if the owner deliberately calls `transferOwnership(address(0))`, which is blocked.

**Actual issue:** There is no two-step ownership transfer (no `pendingOwner` pattern). A single owner mistake — e.g., `transferOwnership(wrongAddress)` — immediately and irreversibly transfers control. All `onlyOwner` functions become controlled by a potentially hostile or unreachable address with no recovery path. This includes `withdrawETH`, `transferToken`, `withdrawERC20Token`, `grantAdmin`, `revokeAdmin`.

**Impact:** Operational risk; all locked funds in the Multicall3 contract (which accepts ETH via `receive()`) could become permanently inaccessible.

---

### [PC1-4] SEVERITY: MEDIUM — ETH permanently trappable via payable aggregate functions with no excess-ETH refund

**File:** `contracts/launchpadv2/multicall3.sol:90-111, 118-137, 145-161, 169-185, 190-233`

`aggregate()`, `tryAggregate()`, `tryBlockAndAggregate()`, `blockAndAggregate()`, and `aggregate3()` are all `payable` but contain no mechanism to:
1. Use `msg.value` for anything (they don't forward ETH in calls)
2. Return excess ETH to the caller

If an owner/admin accidentally sends ETH with any of these calls (e.g., MetaMask sets a value, or a calling contract sends ETH by mistake), that ETH is trapped in the contract. The only recovery is via `withdrawETH()` (owner-only). This is a quality-of-life issue that could cause operational ETH loss.

```solidity
// multicall3.sol:90-111 — payable but never uses msg.value, no refund
function aggregate(Call[] calldata calls) public payable onlyOwnerOrAdmin returns (...) {
    // ...
    (success, returnData[i]) = call.target.call(call.callData); // no {value:...}
```

---

### [PC1-5] SEVERITY: LOW — getBlockHash() with old blockNumbers silently returns bytes32(0)

**File:** `contracts/launchpadv2/multicall3.sol:295-299`

```solidity
function getBlockHash(uint256 blockNumber) public view returns (bytes32 blockHash) {
    blockHash = blockhash(blockNumber);
}
```

`blockhash(n)` returns `bytes32(0)` for any block older than 256 blocks from the current one, or for block numbers in the future. No error is thrown. Any off-chain or on-chain consumer of this function that uses the return value without checking for `bytes32(0)` may make incorrect security decisions (e.g., thinking a block had a particular hash when in fact the EVM cannot provide it). While not directly exploitable within this contract, it is a known footgun that should include a validity check and revert.

---

### [PC1-6] SEVERITY: LOW — approveToken() / batchApproveTokens() callable by admins to approve arbitrary spenders for tokens held by Multicall3

**File:** `contracts/launchpadv2/multicall3.sol:387-422`

`approveToken()` uses `SafeERC20.forceApprove()` which sets approval to any arbitrary amount for any spender, callable by `onlyOwnerOrAdmin`. An admin (not just owner) can set unlimited approvals for any address on any token held in the contract. Combined with the fact that admins can be granted by the owner (line 362), a compromised admin key can drain all ERC-20 balances held in the contract by approving a controlled address and then calling `transferFrom` externally. 

There is no allowlist of tokens or spenders; any address can be used. The `onlyOwner`-gated `withdrawERC20Token` is the guarded withdrawal path, but admins can circumvent this via `approveToken` + external `transferFrom`.

---

### [PC1-7] SEVERITY: LOW — aggregate3() and aggregate3Value() inline assembly reads calldataload at offset 0x20 of calli (calldata pointer) assuming struct layout

**File:** `contracts/launchpadv2/multicall3.sol:202-228, 258-284`

```solidity
// aggregate3(): calli is Call3 calldata — {address target, bool allowFailure, bytes callData}
if iszero(or(calldataload(add(calli, 0x20)), mload(result))) {
```

For `Call3`, the struct layout in calldata is:
- offset 0x00: `target` (address, 32 bytes)
- offset 0x20: `allowFailure` (bool, 32 bytes) ✓

For `Call3Value`, the struct is `{address target, bool allowFailure, uint256 value, bytes callData}`:
- offset 0x00: `target`
- offset 0x20: `allowFailure` ✓
- offset 0x40: `value`
- offset 0x60: callData offset pointer

The assembly reads at offset 0x20 of the calldata pointer `calli` in both cases. This is correct since `allowFailure` is the second field (offset 0x20) in both structs. **No bug here** — but worth documenting that the assembly is layout-dependent and would silently misbehave if the struct were ever modified.

**Actual concern:** `mload(result)` reads from the memory pointer `result` to get the `success` field. In Solidity, a `Result` memory struct `{bool success, bytes returnData}` places `success` at offset 0 of the struct's memory slot — which `mload(result)` correctly reads. This is safe for current Solidity ABI layout but is an undocumented invariant.

---

### [PC1-8] SEVERITY: INFO — No renounce or zero-address protection for admin grants; zombie admin addresses can never be pruned in bulk

**File:** `contracts/launchpadv2/multicall3.sol:359-374`

The `admins` mapping has no enumeration — there is no admin list or admin count. Once many admins are granted, the owner has no way to enumerate and audit all admins. A compromised admin address can only be revoked one at a time via `revokeAdmin()`, and the owner must know each address. If many admins are granted and keys lost, there's no bulk-revoke. This is an operational/governance gap.

---

## Cluster 2: FFactoryV2.sol + FFactoryV3.sol

### [PC1-9] SEVERITY: HIGH — createPair() allows tokenA == tokenB; self-pair creation is not blocked

**File:** `contracts/launchpadv2/FFactoryV2.sol:60-86` and `FFactoryV3.sol:68-94`

The `_createPair()` function only checks that neither token is `address(0)`, but does NOT check that `tokenA != tokenB`:

```solidity
// FFactoryV2.sol:66-67
require(tokenA != address(0), "Zero addresses are not allowed.");
require(tokenB != address(0), "Zero addresses are not allowed.");
// No check: require(tokenA != tokenB)
```

A `CREATOR_ROLE` holder (i.e., BondingV2/V3/V4/V5) can create a pair where both tokens are the same address. The `_pair[tokenA][tokenA]` entry is set, and an `FPairV2` is deployed with `token0 == token1`. The resulting pair will behave nonsensically for all swap/liquidity operations since reserve math assumes two distinct token flows. Note that RS2-9 in the exclusion list covers "factories allow tokenA==tokenB" — this entry documents the specific `FFactoryV2`/`V3` locations which were listed as known but provides additional depth below.

**Deeper consequence not previously documented:** When `_pair[tokenA][tokenB]` is set and `tokenA == tokenB`, the entry `_pair[tokenA][tokenA]` is set to the new pair. Any subsequent call to `createPair(tokenA, tokenA)` with the same token would:
1. Be checked by the router or bonding contract — but only if those contracts check `getPair != address(0)` before creating
2. Overwrite `_pair[tokenA][tokenA]` silently, orphaning the old pair (no duplicate check per RS2-4)

The intersection of RS2-4 (no duplicate check) and RS2-9 (tokenA==tokenB) means: repeated `createPair(X, X)` calls would create unbounded orphaned pairs, each consuming gas and storage.

---

### [PC1-10] SEVERITY: HIGH — CREATOR_ROLE is never granted in initialize(); factory starts in unusable state requiring a separate role-grant step

**File:** `contracts/launchpadv2/FFactoryV2.sol:48-58` and `FFactoryV3.sol:50-66`

```solidity
// FFactoryV2.sol:48-58
function initialize(...) external initializer {
    __AccessControl_init();
    __ReentrancyGuard_init();
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);   // only DEFAULT_ADMIN_ROLE granted
    // CREATOR_ROLE and ADMIN_ROLE are NOT granted
    ...
}
```

After `initialize()`, no address has `CREATOR_ROLE` (required to call `createPair`) or `ADMIN_ROLE` (required to call `setTaxParams` and `setRouter`). The factory is deployed in a state where:
- `createPair()` is callable by no one (reverts for all callers)
- `setRouter()` is callable by no one (reverts for all callers)
- `setTaxParams()` is callable by no one (reverts for all callers)

If the DEFAULT_ADMIN_ROLE holder fails to call `grantRole(CREATOR_ROLE, bondingContract)` and `grantRole(ADMIN_ROLE, adminAddr)` before the factory is used, the system is completely DoS'd. There is no emergency path.

**Critical path to full DoS:** If the deployer loses the DEFAULT_ADMIN_ROLE key before granting CREATOR_ROLE, the factory can never create any pairs — ever. The `Initializable` guard prevents re-initialization, so `initialize()` cannot be called again.

---

### [PC1-11] SEVERITY: MEDIUM — setTaxParams() does not validate antiSniperTaxVault_ for zero address; silently stores address(0)

**File:** `contracts/launchpadv2/FFactoryV2.sol:108-122` and `FFactoryV3.sol:116-130`

```solidity
// FFactoryV2.sol:108-122
function setTaxParams(
    address newVault_,        // validated: require(newVault_ != address(0))
    uint256 buyTax_,
    uint256 sellTax_,
    uint256 antiSniperBuyTaxStartValue_,
    address antiSniperTaxVault_  // NOT validated — can be address(0)
) public onlyRole(ADMIN_ROLE) {
    require(newVault_ != address(0), "Zero addresses are not allowed.");
    taxVault = newVault_;
    ...
    antiSniperTaxVault = antiSniperTaxVault_;  // stored without check
}
```

The `initialize()` function also stores `antiSniperTaxVault_` without a zero-address check (line 57 / 65). If `antiSniperTaxVault` is `address(0)`:

In `FRouterV3.buy()` (FRouterV3.sol:213-218):
```solidity
if (antiSniperTxFee > 0) {
    IERC20(assetToken).safeTransferFrom(to, factory.antiSniperTaxVault(), antiSniperTxFee);
}
```

A `safeTransferFrom` to `address(0)` will revert in standard ERC-20 implementations. This means **any buy() that triggers anti-sniper tax will revert entirely if antiSniperTaxVault is zero**, blocking all purchases during the anti-sniper window. RS2-6 noted `antiSniperTaxVault_` not validated during init — this extends the finding to `setTaxParams()` as well, showing it persists after initialization.

---

### [PC1-12] SEVERITY: MEDIUM — setRouter() called mid-operation silently reroutes all existing pairs to a new, potentially incompatible router

**File:** `contracts/launchpadv2/FFactoryV2.sol:124-126` and `FFactoryV3.sol:132-134`

```solidity
function setRouter(address router_) public onlyRole(ADMIN_ROLE) {
    router = router_;
}
```

`router` stored in the factory is only used for **new** pair creation (passed to `FPairV2` constructor). Once a pair is created, its `router` field is immutable — it's set in `FPairV2`'s constructor and can only be changed via... there is no setter. So existing pairs are unaffected.

**However**, `FRouterV3` reads `factory.getPair(tokenAddress, assetToken)` and uses `factory.antiSniperTaxVault()`, `factory.buyTax()`, `factory.sellTax()` on every trade. If `setRouter` is combined with `setTaxParams` changes mid-operation, in-flight transactions may read inconsistent tax parameters (e.g., buyTax changed between `approve` and `buy` call in a 2-tx flow). No atomicity guarantee exists.

**New deeper issue:** `setRouter(address(0))` is not blocked. If `ADMIN_ROLE` sets `router = address(0)`, all future `createPair()` calls will revert because `FPairV2`'s constructor does `require(router_ != address(0), ...)`. This is a soft DoS vector — new pairs cannot be created until router is re-set.

---

### [PC1-13] SEVERITY: MEDIUM — Tax parameters are not validated for magnitude; buyTax/sellTax can exceed 100, causing integer underflow in router fee calculation

**File:** `contracts/launchpadv2/FFactoryV2.sol:108-122` / `FFactoryV3.sol:116-130` — consumed at `FRouterV3.sol:157-160`

```solidity
// FRouterV3.sol:157-160
uint fee = factory.sellTax();        // e.g., 150 (150%)
uint256 txFee = (fee * amountOut) / 100;  // = 1.5 * amountOut
uint256 amount = amountOut - txFee;       // UNDERFLOW — reverts under checked math
```

If `ADMIN_ROLE` sets `sellTax > 100` in `setTaxParams()`, every sell call will revert due to Solidity 0.8 checked underflow (`amount = amountOut - txFee` where `txFee > amountOut`). Similarly for `buyTax > 100`. This causes a permanent DoS on all trades for affected factories.

The only bound checked is in `FRouterV3.buy()` line 195 which caps `normalTax + antiSniperTax` at 99 total — but this is only for the combined buy tax display, and `sellTax` has no such cap.

**DoS scenario:** ADMIN sets `sellTax = 101`. All sell() calls on FRouterV3 revert permanently until admin resets the value.

---

### [PC1-14] SEVERITY: MEDIUM — FFactoryV2 and FFactoryV3 have identical CREATOR_ROLE and ADMIN_ROLE byte32 values; cross-factory role confusion possible

**File:** `contracts/launchpadv2/FFactoryV2.sol:15-16` and `FFactoryV3.sol:23-24`

```solidity
// FFactoryV2.sol
bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");

// FFactoryV3.sol (identical values)
bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");
```

While role values being the same across both factories doesn't allow cross-factory calls (AccessControl is per-contract state), it creates a documentation/governance confusion: a multi-sig or timelock that manages roles on both factories must ensure it calls `grantRole` on the correct factory contract. If a timelock executes `factory.grantRole(CREATOR_ROLE, bondingV5)` but mistakenly targets FFactoryV2 instead of FFactoryV3, BondingV5 receives `CREATOR_ROLE` on the wrong factory, silently allowing it to create pairs in V2 while having no access to V3.

No technical protection exists to prevent this operational error; the role byte-values being identical across contracts removes the error signal that different role names would provide.

---

### [PC1-15] SEVERITY: LOW — pairs[] array grows unboundedly with no length cap; very large arrays can cause gas exhaustion in iteration

**File:** `contracts/launchpadv2/FFactoryV2.sol:81` and `FFactoryV3.sol:89`

```solidity
pairs.push(address(pair_));
```

Every call to `createPair()` pushes to `pairs[]`. There is no maximum pairs limit. While `allPairsLength()` is a simple view and `pairs[i]` access is O(1), any off-chain or on-chain contract that iterates over all pairs (e.g., for enumeration, admin tooling, or event replay) will face gas issues as the array grows. More practically, the `pairs` array is public storage that can be read by index but has no pagination or enumeration helper. For a high-volume launchpad, this could become a practical operational concern.

---

### [PC1-16] SEVERITY: LOW — No validation that the token passed to createPair() is a contract; EOA addresses accepted as pair tokens

**File:** `contracts/launchpadv2/FFactoryV2.sol:60-86` and `FFactoryV3.sol:68-94`

The zero-address checks exist, but there is no check that `tokenA` or `tokenB` actually contain code (i.e., are deployed contracts). A CREATOR_ROLE holder (BondingV5, etc.) could, under some failure mode, pass an EOA address as one of the tokens. The `FPairV2` pair would be deployed successfully, but any subsequent `safeTransfer`, `balanceOf`, or `forceApprove` call on the "token" would revert (no code at that address). This would make the pair permanently non-functional without providing any clear error at creation time.

**Code-existence check missing:**
```solidity
// FFactoryV2.sol:66-68 — only zero-address checked
require(tokenA != address(0), "Zero addresses are not allowed.");
require(tokenB != address(0), "Zero addresses are not allowed.");
// Missing: require(tokenA.code.length > 0, "tokenA is not a contract")
// Missing: require(tokenB.code.length > 0, "tokenB is not a contract")
```

---

### [PC1-17] SEVERITY: LOW — FFactoryV2 / FFactoryV3 initialize() does not validate buyTax/sellTax/antiSniperBuyTaxStartValue; nonsensical values accepted at deployment

**File:** `contracts/launchpadv2/FFactoryV2.sol:48-58` and `FFactoryV3.sol:50-66`

```solidity
function initialize(
    address taxVault_,
    uint256 buyTax_,           // no upper bound check
    uint256 sellTax_,          // no upper bound check
    uint256 antiSniperBuyTaxStartValue_,  // no upper bound check
    address antiSniperTaxVault_           // no zero-address check
) external initializer {
```

Since `initialize()` can only be called once (guarded by `initializer`), any misconfigured tax values baked in at initialization require re-deploying the proxy or a subsequent `setTaxParams()` call. If `antiSniperTaxVault_` is set to zero at init, all anti-sniper buys will revert until `setTaxParams` is called (but `setTaxParams` requires `ADMIN_ROLE` which is also not granted at init — see PC1-10, creating a circular dependency: factory is broken at init, requires ADMIN_ROLE to fix, but ADMIN_ROLE isn't granted).

---

## Summary Table

| ID | Severity | Contract | Title |
|----|----------|----------|-------|
| PC1-1 | High | multicall3.sol:446-459 | batchTransferTokens/batchWithdrawERC20Tokens call onlyOwner fn — admin role is dead letter |
| PC1-2 | Medium | multicall3.sol:239-291 | aggregate3Value stuck ETH when allowFailure call reverts |
| PC1-3 | Medium | multicall3.sol:350-357 | One-step ownership transfer — no recovery from mistaken transfer |
| PC1-4 | Medium | multicall3.sol:90-185 | payable aggregates with no msg.value usage or refund traps ETH |
| PC1-5 | Low | multicall3.sol:295-299 | getBlockHash() returns bytes32(0) silently for old blocks |
| PC1-6 | Low | multicall3.sol:387-422 | Admin can drain ERC-20s via approveToken() + external transferFrom |
| PC1-7 | Info | multicall3.sol:202-228, 258-284 | Inline assembly struct-layout assumption (documented invariant) |
| PC1-8 | Info | multicall3.sol:359-374 | No admin enumeration; bulk revoke impossible |
| PC1-9 | High | FFactoryV2:60-86, FFactoryV3:68-94 | tokenA==tokenB creates self-pair; intersection with RS2-4 creates orphan pair flood |
| PC1-10 | High | FFactoryV2:48-58, FFactoryV3:50-66 | CREATOR_ROLE and ADMIN_ROLE never granted at initialize(); factory starts fully DoS'd |
| PC1-11 | Medium | FFactoryV2:108-122, FFactoryV3:116-130 | setTaxParams() does not validate antiSniperTaxVault_ for zero address |
| PC1-12 | Medium | FFactoryV2:124-126, FFactoryV3:132-134 | setRouter(address(0)) not blocked; DoS on future pair creation |
| PC1-13 | Medium | FFactoryV2:108-122, FFactoryV3:116-130 | No tax magnitude cap; sellTax > 100 causes permanent revert on all sells |
| PC1-14 | Medium | FFactoryV2:15-16, FFactoryV3:23-24 | Identical role bytes across factories; cross-factory role grant confusion |
| PC1-15 | Low | FFactoryV2:81, FFactoryV3:89 | pairs[] grows unboundedly; no length cap |
| PC1-16 | Low | FFactoryV2:60-86, FFactoryV3:68-94 | No code-existence check on token addresses at pair creation |
| PC1-17 | Low | FFactoryV2:48-58, FFactoryV3:50-66 | initialize() accepts unchecked tax values + zero antiSniperTaxVault; circular fix dependency with PC1-10 |
