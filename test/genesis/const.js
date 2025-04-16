// test/genesis/const.js

// Genesis state error messages
const ERR_NOT_STARTED = "Genesis not started yet";
const ERR_ALREADY_STARTED = "Genesis already started";
const ERR_NOT_ENDED = "Genesis not ended yet";
const ERR_ALREADY_ENDED = "Genesis already ended";
const ERR_ALREADY_FAILED = "Genesis already failed";
const ERR_ALREADY_CANCELLED = "Genesis already cancelled";

// Time validation error messages
const ERR_START_TIME_FUTURE = "Start time must be in the future";
const ERR_END_AFTER_START = "End time must be after start time";

// Token related error messages
const ERR_TOKEN_LAUNCHED = "Agent token already launched";
const ERR_TOKEN_NOT_LAUNCHED = "Agent token not launched";

// Balance related error messages
const ERR_INSUFFICIENT_BALANCE = "Insufficient Virtual Token balance";
const ERR_INSUFFICIENT_ALLOWANCE = "Insufficient Virtual Token allowance";
const ERR_INSUFFICIENT_COMMITTED = "Insufficient Virtual Token committed";
const ERR_NO_TOKENS_TO_CLAIM = "No tokens to claim";

// Other validation error messages
const ERR_INVALID_TOKEN_ADDRESS = "Invalid token address";
const ERR_NO_TOKEN_TO_WITHDRAW = "No token left to withdraw";
const ERR_INDEX_OUT_OF_BOUNDS = "Start index out of bounds";

module.exports = {
    ERR_NOT_STARTED,
    ERR_ALREADY_STARTED,
    ERR_NOT_ENDED,
    ERR_ALREADY_ENDED,
    ERR_ALREADY_FAILED,
    ERR_ALREADY_CANCELLED,
    ERR_START_TIME_FUTURE,
    ERR_END_AFTER_START,
    ERR_TOKEN_LAUNCHED,
    ERR_TOKEN_NOT_LAUNCHED,
    ERR_INSUFFICIENT_BALANCE,
    ERR_INSUFFICIENT_ALLOWANCE,
    ERR_INSUFFICIENT_COMMITTED,
    ERR_NO_TOKENS_TO_CLAIM,
    ERR_INVALID_TOKEN_ADDRESS,
    ERR_NO_TOKEN_TO_WITHDRAW,
    ERR_INDEX_OUT_OF_BOUNDS
};