// test/newLaunchpad/const.js

// BondingV2 error messages
const ERR_INVALID_TOKEN_STATUS = "InvalidTokenStatus";
const ERR_INVALID_INPUT = "InvalidInput";
const ERR_SLIPPAGE_TOO_HIGH = "SlippageTooHigh";

// FRouter error messages
const ERR_ZERO_ADDRESSES = "Zero addresses are not allowed";
const ERR_AMOUNT_MUST_BE_GREATER_THAN_ZERO = "amountIn must be greater than 0";

// FPairV2 error messages
const ERR_INVALID_START_TIME = "InvalidStartTime";

// AgentFactoryV6 error messages
const ERR_AGENT_ALREADY_EXISTS = "AgentAlreadyExists";
const ERR_CORES_MUST_BE_PROVIDED = "Cores must be provided";
const ERR_INSUFFICIENT_ASSET_TOKEN = "Insufficient asset token";
const ERR_INSUFFICIENT_ASSET_TOKEN_ALLOWANCE =
  "Insufficient asset token allowance";
const ERR_NOT_PROPOSER = "Not proposer";
const ERR_APPLICATION_NOT_ACTIVE = "Application is not active";
const ERR_APPLICATION_NOT_MATURED = "Application is not matured yet";
const ERR_TOKEN_ADMIN_NOT_SET = "Token admin not set";
const ERR_APPLICATION_TOKEN_ADDRESS_NOT_SET =
  "application tokenAddress not set";

// Time constants
const START_TIME_DELAY = 86400; // 24 hours
const DAO_VOTING_PERIOD = 259200; // 3 days
const DAO_THRESHOLD = 0;

// TBA constants
const TBA_SALT =
  "0xa7647ac9429fdce477ebd9a95510385b756c757c26149e740abbab0ad1be2f16";
const TBA_IMPLEMENTATION = "0x55266d75D1a14E4572138116aF39863Ed6596E7F";

// Token supply constants
const INITIAL_SUPPLY = "1000000000"; // 1B tokens
const LP_SUPPLY = "0"; // go to agentTokenAddress
const VAULT_SUPPLY = "1000000000"; // 1B go to bonding contract itself
const TEAM_TOKEN_RESERVED_SUPPLY = "550000000"; // 550M tokens

// Fee constants
const BUY_TAX = 1; // 1% (percentage)
const SELL_TAX = 1; // 1% (percentage)
const ANTI_SNIPER_BUY_TAX_START_VALUE = 99; // 99% (percentage)
const APPLICATION_THRESHOLD = "100000000000000000000"; // 100 VIRTUAL tokens

// Bonding curve constants
// const K = "3000000000000";
const ASSET_RATE = 5000;
// 29439252 VIRTUAL tokens, means 200,000.00244571431 real Virtual need to accumulate to graduate
const GRAD_THRESHOLD = "29439252000000000000000000";
const MAX_TX = 100; // 1%

// FFactoryV2 constants
const FFactoryV2_TAX_VAULT = "0x6dCF5c604B5E6B8c28a6bE1C629387485037beAc";
const FFactoryV2_ANTI_SNIPER_TAX_VAULT = "0xa9bbF40dc8e522e96b534a3866a614f41b3B0593";

module.exports = {
  // Error messages
  ERR_INVALID_TOKEN_STATUS,
  ERR_INVALID_INPUT,
  ERR_SLIPPAGE_TOO_HIGH,
  ERR_ZERO_ADDRESSES,
  ERR_AMOUNT_MUST_BE_GREATER_THAN_ZERO,
  ERR_INVALID_START_TIME,
  ERR_AGENT_ALREADY_EXISTS,
  ERR_CORES_MUST_BE_PROVIDED,
  ERR_INSUFFICIENT_ASSET_TOKEN,
  ERR_INSUFFICIENT_ASSET_TOKEN_ALLOWANCE,
  ERR_NOT_PROPOSER,
  ERR_APPLICATION_NOT_ACTIVE,
  ERR_APPLICATION_NOT_MATURED,
  ERR_TOKEN_ADMIN_NOT_SET,
  ERR_APPLICATION_TOKEN_ADDRESS_NOT_SET,

  // Time constants
  START_TIME_DELAY,
  DAO_VOTING_PERIOD,
  DAO_THRESHOLD,

  // TBA constants
  TBA_SALT,
  TBA_IMPLEMENTATION,

  // Token supply constants
  INITIAL_SUPPLY,
  LP_SUPPLY,
  VAULT_SUPPLY,
  TEAM_TOKEN_RESERVED_SUPPLY,

  // Fee constants
  BUY_TAX,
  SELL_TAX,
  ANTI_SNIPER_BUY_TAX_START_VALUE,
  APPLICATION_THRESHOLD,

  // Bonding curve constants
  // K,
  ASSET_RATE,
  GRAD_THRESHOLD,
  MAX_TX,

  // FFactoryV2 constants
  FFactoryV2_TAX_VAULT,
  FFactoryV2_ANTI_SNIPER_TAX_VAULT,
};
