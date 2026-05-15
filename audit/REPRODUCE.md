# Auditor Reproduction Guide

Step-by-step instructions for the auditor to bring up a local copy, run tests,
and observe a deployed testnet instance.

---

## 1. Prerequisites

- Node.js 20.x (LTS)
- npm 10.x or pnpm 9.x
- Foundry (forge / cast / anvil) — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- Python 3.11+ (for Slither)
- pip install slither-analyzer mythril
- An RPC endpoint for BSC mainnet & testnet (Ankr / Infura / public)
- A funded BSC-testnet account (BNB faucet: https://testnet.bnbchain.org/faucet-smart)

---

## 2. Clone

```
git clone <REPO_URL> agentflow-contracts
cd agentflow-contracts
git log --oneline -10                # confirm commit hash matches audit tag
git checkout audit-2026-04           # immutable audit tag
```

---

## 3. Install dependencies

```
npm install
forge install                        # populates lib/ from foundry.toml
```

Expected: zero errors. `node_modules/` ~ 400 MB.

---

## 4. Compile

```
npm run compile
# or:
npx hardhat compile
forge build
```

Both Hardhat and Foundry must succeed. Hardhat is the canonical compiler
(matches deployment), Foundry is for tests.

Compiler settings: `solc 0.8.26`, optimizer 200 runs, viaIR = true.

---

## 5. Test (Hardhat + Foundry)

```
npm test                             # Hardhat suite
forge test -vv                       # Foundry suite
forge test --match-path test/invariants -vvv
```

Expected: 100 % pass, ~ 200+ tests across both. Fuzz + invariant tests run
by default; for deep fuzz use:

```
forge test --match-contract Invariant_ --fuzz-runs 100000
```

---

## 6. Coverage

```
npm run coverage
# or:
forge coverage --report lcov
```

Open `coverage/index.html`. Acceptance criteria:

- **Line coverage ≥ 95 %** on `contracts/referral/`, `contracts/fun/`,
  `contracts/Migrator.sol`.
- **Branch coverage = 100 %** on those files.
- < 90 % on any of the above is a blocker.

---

## 7. Slither

```
npm run slither
# or:
slither . --config-file slither.config.json
```

Expected output: zero findings of severity HIGH or CRITICAL. MEDIUM findings
documented in `audit/SLITHER_TRIAGE.md` (created if non-trivial).

---

## 8. Mythril (optional, deep symbolic exec)

```
myth analyze contracts/referral/ReferralPayouts.sol --solv 0.8.26
myth analyze contracts/fun/Bonding.sol --solv 0.8.26
```

Time: ~ 30 min per file. Run on top-priority contracts only.

---

## 9. Deploy to BSC testnet

```
cp .env.example .env
# Fill: PRIVATE_KEY, BSC_TESTNET_RPC, BSCSCAN_API_KEY
npx ts-node script/deploy-bsc-testnet.ts
```

Output prints:

```
ReferralRegistry deployed:    0x...
ReferralPayouts deployed:     0x...
FFactory deployed:            0x...
FRouter deployed:             0x...
Bonding deployed:             0x...
Migrator deployed:            0x...
LiquidityLocker deployed:     0x...
```

Verify on BscScan testnet (script auto-runs `hardhat verify` per address).

---

## 10. End-to-end smoke test (manual)

1. Open MetaMask → switch to BSC Testnet (chain ID 97).
2. Import test paymentToken (mock USDC) at the address printed by deploy.
3. Mint 10 000 USDC to your address (`MockUSDC.mint(self, ...)`).
4. **Register referrer (optional):** call `ReferralRegistry.register(<friend>)`.
5. **Create bonding token:** call `Bonding.launch("Test", "TST", "ipfs://...")`.
   Get the token address from the `TokenLaunched` event.
6. **Buy on curve:** approve USDC, call `FRouter.swap(token, USDC, amountIn,
   minOut)`. Receive curve token.
7. **Verify referral credit:** read `ReferralPayouts.pendingRewards(friend, USDC)`
   — non-zero.
8. **Sell on curve:** approve token, swap back.
9. **Force graduation:** buy enough to cross threshold. Verify `Graduated`
   event. AMM pair address is now in `Migrator.dexPair(token)`.
10. **Try to swap on curve post-grad:** must revert with
    `error CurveGraduated()`.
11. **Trade on AMM pair:** open Pancake testnet UI, paste token address, swap.
12. **Claim referral reward:** as `friend`, call `ReferralPayouts.claim(USDC)`.
    Receive USDC, `pendingRewards = 0`.

All 12 steps should succeed end-to-end on a single testnet session.

---

## 11. Verified contract links

After step 9, the deploy script prints BscScan URLs. Examples:

- `https://testnet.bscscan.com/address/<ReferralRegistry>#code` — source
  verified, "Read Contract" / "Write Contract" tabs work.
- `https://testnet.bscscan.com/address/<Bonding>#code`
- `https://testnet.bscscan.com/address/<Migrator>#code`

Live testnet deployment (current audit tag): see
`deployments/bsc-testnet.json` for canonical addresses.

---

## 12. Reproducing fuzz seeds

Foundry invariant test failures are deterministic per seed. To replay:

```
FOUNDRY_FUZZ_SEED=0xdeadbeef forge test --match-test test_invariant_payouts_le_fees -vvv
```

Recorded seeds for known cases: `test/invariants/seeds.txt`.

---

## 13. Static-analysis & report bundling

If you want to ship a HTML report bundle:

```
npm run audit:bundle
# produces: audit-output/
#   ├─ slither-report.html
#   ├─ coverage/
#   ├─ test-output.txt
#   └─ contracts-flattened/
```

---

## 14. Contact during audit

Slack channel `#audit-q-and-a` (invite in audit kickoff email). Daily standup
optional. Findings filed in private GitHub repo `agentflow-audit-findings`.
