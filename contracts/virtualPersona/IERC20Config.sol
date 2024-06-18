// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Config {
  struct ERC20Config {
    bytes baseParameters;
    bytes supplyParameters;
    bytes taxParameters;
    bytes poolParameters;
  }

  struct ERC20BaseParameters {
    string name;
    string symbol;
  }

  struct ERC20SupplyParameters {
    uint256 maxSupply;
    uint256 lpSupply;
    uint256 vaultSupply;
    uint256 maxTokensPerWallet;
    uint256 maxTokensPerTxn;
    uint256 botProtectionDurationInSeconds;
    address vault;
  }

  struct ERC20TaxParameters {
    uint256 projectBuyTaxBasisPoints;
    uint256 projectSellTaxBasisPoints;
    uint256 taxSwapThresholdBasisPoints;
    address projectTaxRecipient;
  }
}