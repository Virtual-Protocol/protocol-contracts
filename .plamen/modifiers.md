# Modifier Definitions (grep fallback - SLITHER UNAVAILABLE)

Source: grep on contracts/launchpadv2/*.sol

## FPairV2.sol
- `modifier onlyRouter()` (line 61): Restricts calls to the designated router address

## multicall3.sol
- `modifier onlyOwner()` (line 46): Restricts to contract owner
- `modifier onlyOwnerOrAdmin()` (line 51): Restricts to owner or admin

## Notes
- BondingV2–V5 inherit from Ownable/AccessControl (OpenZeppelin), no custom modifiers defined locally
- BondingConfig.sol uses OpenZeppelin Ownable
- FFactoryV2/V3 use Ownable
- FRouterV2/V3 use Ownable
