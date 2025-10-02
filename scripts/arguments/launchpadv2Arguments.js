module.exports = [
  // Virtual Token address
  process.env.BRIDGED_TOKEN || "0xbfAB80ccc15DF6fb7185f9498d6039317331846a",
  // BUY_TAX (percentage)
  process.env.BUY_TAX || "1",
  // SELL_TAX (percentage)
  process.env.SELL_TAX || "1",
  // ANTI_SNIPER_BUY_TAX_START_VALUE (percentage)
  process.env.ANTI_SNIPER_BUY_TAX_START_VALUE || "99",
  // Fee address
  process.env.NEW_LAUNCHPAD_FEE_ADDRESS ||
    "0xd56dc8b053027d4f5309c60678dec898aa6c0106", // vp-test-2
  // Fee amount
  process.env.NEW_LAUNCHPAD_FEE_AMOUNT || "100000", // 100 tokens
  // Initial supply
  process.env.INITIAL_SUPPLY || "1000000000",
  // Asset rate
  process.env.ASSET_RATE || "5000",
  // Max TX
  process.env.MAX_TX || "100",
  // Graduation threshold
  process.env.GRAD_THRESHOLD || "29439252000000000000000000",
  // Start time delay
  process.env.START_TIME_DELAY || "86400", // 24 hours
  // TBA Salt
  process.env.TBA_SALT ||
    "0xa7647ac9429fdce477ebd9a95510385b756c757c26149e740abbab0ad1be2f16",
  // TBA Registry
  process.env.TBA_REGISTRY || "0x1D7aAf461d4899F3805cBBb80BAa38721F9b09f3",
  // TBA Implementation
  process.env.TBA_IMPLEMENTATION ||
    "0x55266d75D1a14E4572138116aF39863Ed6596E7F",
  // DAO voting period
  process.env.DAO_VOTING_PERIOD || "900",
  // DAO threshold
  process.env.DAO_THRESHOLD || "0",
  // Team token reserved supply
  process.env.TEAM_TOKEN_RESERVED_SUPPLY || "550000000", // 550M tokens
  // Application threshold
  process.env.VIRTUAL_APPLICATION_THRESHOLD || "125000000000000000000 ", // 100 VIRTUAL tokens
  // UniswapV2Factory address
  process.env.UNISWAP_V2_FACTORY ||
    "0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e",
  // UniswapV2Router02 address
  process.env.UNISWAP_V2_ROUTER || "0x1689E7B1F10000AE47eBfE339a4f69dECd19F602",
  // AgentNftV2 address
  process.env.AGENT_NFT_V2 || "0x756C50FF360f0e1061Ca7A3e9125e4c3027C3cDD",
  // TaxVault address
  process.env.FFactoryV2_TAX_VAULT || "0x6dCF5c604B5E6B8c28a6bE1C629387485037beAc",
  // AntiSniperTaxVault address
  process.env.FFactoryV2_ANTI_SNIPER_TAX_VAULT || "0xa9bbF40dc8e522e96b534a3866a614f41b3B0593",
];
