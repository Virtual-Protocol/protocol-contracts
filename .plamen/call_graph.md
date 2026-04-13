# Call Graph

Call graph unavailable - Slither failed (MCP tool not available in environment).

## Manually observed call patterns (grep-based)

### BondingV2/V3/V4/V5 → FPairV2
- buy() → IFPairV2.swap()
- sell() → IFPairV2.swap()
- launch() → IFPairV2.transferAsset() → ERC20.transfer()
- drainLiquidity() → IFPairV2.syncAfterDrain()

### FRouterV2/V3 → FFactoryV2/V3
- buy/sell → IFFactory.getPair() → IFPairV2.*

### BondingV5 → BondingConfig
- Uses BondingConfig for shared configuration parameters

### multicall3.sol
- aggregate3Value() → external calls via `.call{value}()` (line 255)
- withdrawEth() → `.call{value}()` (line 520)
