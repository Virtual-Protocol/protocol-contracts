// Utility functions for newLaunchpad tests
//
// Time Utilities:
// - increaseTimeAndMine(seconds): Increase time by seconds and mine a block
// - increaseTimeByMinutes(minutes): Increase time by minutes and mine a block
// - increaseTimeByHours(hours): Increase time by hours and mine a block
// - increaseTimeByDays(days): Increase time by days and mine a block
//
// Precision Testing:
// - expectApproximatelyEqual(actual, expected, description, significantDigits)
// - expectTokenBalanceEqual(actual, expected, tokenName)
// - expectPercentageEqual(actual, expected, description)
// - expectPriceEqual(actual, expected, description)
//
// Usage Examples:
// await increaseTimeByMinutes(30); // Wait 30 minutes and update block.timestamp
// expectTokenBalanceEqual(balance, expectedBalance, "USDT"); // Compare token balances

const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { network } = require("hardhat");

/**
 * Compare two BigInt values with precision tolerance
 * @param actual - The actual value to compare
 * @param expected - The expected value
 * @param description - Optional description for better error messages
 * @param significantDigits - Number of significant digits for precision (default: 8)
 */
const expectApproximatelyEqual = (
  actual,
  expected,
  description = "",
  significantDigits = 8
) => {
  const actualNum = Number(actual);
  const expectedNum = Number(expected);
  const tolerance = expectedNum * Math.pow(10, -significantDigits); // e.g., 1e-8 for 8 significant digits
  const diff = Math.abs(actualNum - expectedNum);

  expect(diff).to.be.lessThan(
    tolerance,
    `${description}: Expected ${expectedNum}, got ${actualNum}, diff ${diff}, tolerance ${tolerance}`
  );
};

/**
 * Compare token amounts with default 8 significant digits precision
 * Specifically designed for ERC20 token balance comparisons
 * @param actual - The actual token balance
 * @param expected - The expected token balance
 * @param tokenName - Name of the token for error messages
 */
const expectTokenBalanceEqual = (actual, expected, tokenName = "Token") => {
  expectApproximatelyEqual(actual, expected, `${tokenName} balance`, 8);
};

/**
 * Compare percentage values with higher precision tolerance
 * @param actual - The actual percentage value
 * @param expected - The expected percentage value
 * @param description - Optional description for better error messages
 */
const expectPercentageEqual = (
  actual,
  expected,
  description = "Percentage"
) => {
  expectApproximatelyEqual(actual, expected, description, 6); // 6 significant digits for percentages
};

/**
 * Compare price values with moderate precision tolerance
 * @param actual - The actual price value
 * @param expected - The expected price value
 * @param description - Optional description for better error messages
 */
const expectPriceEqual = (actual, expected, description = "Price") => {
  expectApproximatelyEqual(actual, expected, description, 10); // 10 significant digits for prices
};

/**
 * Increase blockchain time and ensure block.timestamp is updated
 * This function combines time.increase() with mining a new block to ensure
 * that block.timestamp reflects the time change in subsequent transactions
 * @param seconds - Number of seconds to increase time by
 */
const increaseTimeAndMine = async (seconds) => {
  await time.increase(seconds);
  await network.provider.send("evm_mine");
};

/**
 * Increase blockchain time by minutes and ensure block.timestamp is updated
 * @param minutes - Number of minutes to increase time by
 */
const increaseTimeByMinutes = async (minutes) => {
  await increaseTimeAndMine(minutes * 60);
};

/**
 * Increase blockchain time by hours and ensure block.timestamp is updated
 * @param hours - Number of hours to increase time by
 */
const increaseTimeByHours = async (hours) => {
  await increaseTimeAndMine(hours * 60 * 60);
};

/**
 * Increase blockchain time by days and ensure block.timestamp is updated
 * @param days - Number of days to increase time by
 */
const increaseTimeByDays = async (days) => {
  await increaseTimeAndMine(days * 24 * 60 * 60);
};

module.exports = {
  expectApproximatelyEqual,
  expectTokenBalanceEqual,
  expectPercentageEqual,
  expectPriceEqual,
  increaseTimeAndMine,
  increaseTimeByMinutes,
  increaseTimeByHours,
  increaseTimeByDays,
};
