// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {FixedPointMathLib as fp} from "./FixedPointMathLib.sol";

library Elo {
    /// @notice Get the 16th root of a number, used in ELO calculations
    /// @dev Elo calculations require the 400th root (10 ^ (x / 400)), however this can be simplified to the 16th root (10 ^ ((x / 25) / 16))
    function sixteenthRoot(uint256 x) internal pure returns (uint256) {
        return fp.sqrt(fp.sqrt(fp.sqrt(fp.sqrt(x))));
    }

    /// @notice Calculates the change in ELO rating, after a given outcome.
    /// @param ratingA the ELO rating of the player A
    /// @param ratingB the ELO rating of the player B
    /// @param score the score of the player A, scaled by 100. 100 = win, 50 = draw, 0 = loss
    /// @param kFactor the k-factor or development multiplier used to calculate the change in ELO rating. 20 is the typical value
    /// @return change the change in ELO rating of player A, with 2 decimals of precision. 1501 = 15.01 ELO change
    /// @return negative the directional change of player A's ELO. Opposite sign for player B
    function ratingChange(uint256 ratingA, uint256 ratingB, uint256 score, uint256 kFactor)
        internal
        pure
        returns (uint256 change, bool negative)
    {
        uint256 _kFactor; // scaled up `kFactor` by 100
        bool _negative = ratingB < ratingA;
        uint256 ratingDiff; // absolute value difference between `ratingA` and `ratingB`

        unchecked {
            // scale up the inputs by a factor of 100
            // since our elo math is scaled up by 100 (to avoid low precision integer division)
            _kFactor = kFactor * 10_000;
            ratingDiff = _negative ? ratingA - ratingB : ratingB - ratingA;
        }

        // checks against overflow/underflow, discovered via fuzzing
        // large rating diffs leads to 10^ratingDiff being too large to fit in a uint256
        require(ratingDiff < 1126, "Rating difference too large");
        // large rating diffs when applying the scale factor leads to underflow (800 - ratingDiff)
        if (_negative) require(ratingDiff < 800, "Rating difference too large");

        // ----------------------------------------------------------------------
        // Below, we'll be running simplified versions of the following formulas:
        // expected score = 1 / (1 + 10 ^ (ratingDiff / 400))
        // elo change = kFactor * (score - expectedScore)

        uint256 n; // numerator of the power, with scaling, (numerator of `ratingDiff / 400`)
        uint256 _powered; // the value of 10 ^ numerator
        uint256 powered; // the value of 16th root of 10 ^ numerator (fully resolved 10 ^ (ratingDiff / 400))
        uint256 kExpectedScore; // the expected score with K factor distributed
        uint256 kScore; // the actual score with K factor distributed

        unchecked {
            // apply offset of 800 to scale the result by 100
            n = _negative ? 800 - ratingDiff : 800 + ratingDiff;

            // (x / 400) is the same as ((x / 25) / 16))
            _powered = fp.rpow(10, n / 25, 1); // divide by 25 to avoid reach uint256 max
            powered = sixteenthRoot(_powered); // x ^ (1 / 16) is the same as 16th root of x

            // given `change = kFactor * (score - expectedScore)` we can distribute kFactor to both terms
            kExpectedScore = _kFactor / (100 + powered); // both numerator and denominator scaled up by 100
            kScore = kFactor * score; // input score is already scaled up by 100

            // determines the sign of the ELO change
            negative = kScore < kExpectedScore;
            change = negative ? kExpectedScore - kScore : kScore - kExpectedScore;
        }
    }
}