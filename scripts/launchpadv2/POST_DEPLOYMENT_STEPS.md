# Post-Deployment Manual Steps

After running the deployment script, the following manual steps need to be completed:

## ⚠️ Required Manual Step

### Grant MINTER_ROLE to AgentFactoryV6

The deployment script will output the exact details, but you need to execute:

```solidity
// Call this function on AgentNftV2 contract using the ADMIN account
AgentNftV2.grantRole(MINTER_ROLE, <AgentFactoryV6_Address>)
```

**Why this step is manual:**
- `AgentNftV2` is an existing contract on Base Sepolia
- Only accounts with `DEFAULT_ADMIN_ROLE` can grant `MINTER_ROLE`
- The deployment script doesn't have access to the ADMIN private key for security reasons

**How to execute:**
1. Use the ADMIN account (multisig or EOA) that has `DEFAULT_ADMIN_ROLE` on `AgentNftV2`
2. Call `grantRole(keccak256("MINTER_ROLE"), agentFactoryV6Address)` on the `AgentNftV2` contract
3. Verify the role was granted by calling `hasRole(MINTER_ROLE, agentFactoryV6Address)`

**Contract Addresses:**
- The deployment script will output the exact addresses needed
- Look for the "⚠️ MANUAL STEP REQUIRED" section in the deployment output

## Verification Steps

After completing the manual step, verify the deployment:

1. **Check AgentFactoryV6 can mint:**
   ```solidity
   AgentNftV2.hasRole(MINTER_ROLE, <AgentFactoryV6_Address>) // should return true
   ```

2. **Check all roles are assigned correctly:**
   - `FFactoryV2.hasRole(ADMIN_ROLE, CONTRACT_CONTROLLER)`
   - `FRouterV2.hasRole(DEFAULT_ADMIN_ROLE, CONTRACT_CONTROLLER)`
   - `FRouterV2.hasRole(EXECUTOR_ROLE, BondingV2_Address)`
   - `AgentFactoryV6.hasRole(DEFAULT_ADMIN_ROLE, CONTRACT_CONTROLLER)`

3. **Check ownership transfers:**
   - `BondingV2.owner() == CONTRACT_CONTROLLER`

## Security Notes

- All deployer temporary roles have been revoked
- Only necessary roles remain assigned
- `BondingV2` ownership has been transferred to `CONTRACT_CONTROLLER`
- All proxy contracts use proper access controls

## Troubleshooting

If the manual step fails:
1. Verify the ADMIN account has `DEFAULT_ADMIN_ROLE` on `AgentNftV2`
2. Check the `AgentFactoryV6` address is correct
3. Ensure sufficient gas for the transaction
4. Verify the contract addresses match the deployment output
