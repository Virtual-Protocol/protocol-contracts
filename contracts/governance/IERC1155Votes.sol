// SPDX-License-Identifier: MIT
// Modified from OpenZeppelin Contracts (last updated v5.0.0) (governance/utils/IVotes.sol)
pragma solidity ^0.8.20;

import "./IERC1155V.sol";
import {IERC6372} from "@openzeppelin/contracts/interfaces/IERC6372.sol";

interface IERC1155Votes is IERC1155V, IERC6372 {}
