#!/bin/bash
# Deployment Script for V5 Suite
# 
# This script runs deployment scripts 0-4 sequentially.
#
# ============================================================================
# CONFIGURATION (edit these defaults or pass via command line)
# ============================================================================
DEFAULT_NETWORK="local"                    # local, base_sepolia, base
DEFAULT_ENV_FILE=".env.launchpadv5_dev_bsc_local"  # .env.launchpadv5_local, .env.launchpadv5_dev, .env.launchpadv5_prod
# ============================================================================
#
# Usage (from protocol-contracts directory):
#   ./scripts/launchpadv5/run_local_deploy.sh                          # Use defaults above
#   ./scripts/launchpadv5/run_local_deploy.sh --network base_sepolia   # Override network
#   ./scripts/launchpadv5/run_local_deploy.sh --env .env.launchpadv5_dev  # Override env file
#   ./scripts/launchpadv5/run_local_deploy.sh --network base_sepolia --env .env.launchpadv5_dev
#
# Commands (after network/env args):
#   (none)        # Full deploy: for local, kills node and starts fork; deploys all (0-4)
#   deploy-only   # Deploy only (for local, assumes node is running)
#   node-only     # Start fork node only (local network only)
#   0|1|2|3|4     # Run only that step
#
# Examples:
#   ./scripts/launchpadv5/run_local_deploy.sh                                    # local fork, full deploy
#   ./scripts/launchpadv5/run_local_deploy.sh deploy-only                        # local, deploy only
#   ./scripts/launchpadv5/run_local_deploy.sh --network base_sepolia             # deploy to base_sepolia
#   ./scripts/launchpadv5/run_local_deploy.sh --network base_sepolia --env .env.launchpadv5_dev
#   ./scripts/launchpadv5/run_local_deploy.sh --network base_sepolia 0           # run step 0 on base_sepolia
#   ./scripts/launchpadv5/run_local_deploy.sh --network base_sepolia 4           # run step 4 (revoke roles)
#
# Full deploy (deploy-only / default) on local, bsc_testnet, monad_testnet runs
# deployUniswapV2TestnetLiquidity.ts first unless UNISWAP_V2_ROUTER and AGENT_TAX_ASSET_TOKEN are both
# valid addresses. If AGENT_TAX_ASSET_TOKEN is unset, the script prompts (TTY) before running UniV2;
# use LAUNCHPAD_AUTO_UNIV2=1 in env to skip the prompt and run automatically. The TS script can prompt
# to deploy mock VIRTUAL if VIRTUAL_TOKEN_ADDRESS / AGENT_TAX_TAX_TOKEN are missing and writes ENV_FILE.
#
# Resume / env handling:
#   This script never blanks your env file — existing addresses are kept so you can re-run after partial
#   failure or Ctrl+C. Hardhat scripts skip steps when addresses are already set.
#   To force a full redeploy, remove the relevant keys from the env file yourself.
#   On exit, an EXIT trap clears exported variables that came from the env file (and ENV_FILE / FORK_RPC_URL)
#   so the shell is not left polluted (relevant when this script is sourced; harmless when run as ./...).
#
# Networks:
#   local         - Fork locally via `npx hardhat node`. FORK_RPC_URL is required in the env file (HTTPS RPC
#                   of the chain where VIRTUAL_TOKEN_ADDRESS and other pinned addresses exist).
#   base_sepolia  - Deploy directly to Base Sepolia testnet
#   base          - Deploy directly to Base mainnet (use with caution!)
#   bsc_testnet   - Deploy directly to BSC testnet (hardhat `bsc_testnet` url: BSC_TESTNET_RPC_URL,
#                   then RPC_URL, then default; set these in the same env file you pass with --env).
#   monad_testnet - Monad testnet (chainId 10143); MONAD_TESTNET_RPC_URL or RPC_URL in env file.

set -e

# Path to the env file used for this run (set after --env is resolved). Used by EXIT cleanup.
_LAUNCHPAD_ENV_PATH=""

# Unset every KEY listed in env_path so a following `source "$env_path"` is authoritative (omitted keys stay unset).
# Used before re-sourcing mid-script; also used by EXIT cleanup (EXIT does not run until the script ends).
unset_env_file_keys() {
    local env_path="$1"
    [ -n "$env_path" ] && [ -f "$env_path" ] || return 0
    local line key
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%%#*}"
        line="${line#"${line%%[![:space:]]*}"}"
        line="${line%"${line##*[![:space:]]}"}"
        [ -z "$line" ] && continue
        if [[ "$line" =~ ^export[[:space:]]+ ]]; then
            line="${line#export}"
            line="${line#"${line%%[![:space:]]*}"}"
        fi
        [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]] || continue
        key="${BASH_REMATCH[1]}"
        # Never unset ENV_FILE here: this script uses that name for the path to the env file (same as --env).
        [[ "$key" == "ENV_FILE" ]] && continue
        unset "$key" 2>/dev/null || true
    done < "$env_path"
}

# On exit: unset keys from the launchpad env file plus ENV_FILE / FORK_RPC_URL exports added by this script.
cleanup_launchpad_env_exports() {
    unset_env_file_keys "${_LAUNCHPAD_ENV_PATH:-}"
    unset ENV_FILE FORK_RPC_URL 2>/dev/null || true
}

# ============================================================================
# Parse arguments
# ============================================================================
NETWORK="$DEFAULT_NETWORK"
ENV_FILE="$DEFAULT_ENV_FILE"
COMMAND=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --network|-n)
            NETWORK="$2"
            shift 2
            ;;
        --env|-e)
            ENV_FILE="$2"
            shift 2
            ;;
        *)
            COMMAND="$1"
            shift
            ;;
    esac
done

# ============================================================================
# Setup
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_DIR"

echo "========================================"
echo "  V5 Suite Deployment"
echo "========================================"
echo ""
echo "Network:  $NETWORK"
echo "Env file: $ENV_FILE"
echo "Command:  ${COMMAND:-full-deploy}"
echo ""

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found!"
    exit 1
fi

_LAUNCHPAD_ENV_PATH="$ENV_FILE"
trap cleanup_launchpad_env_exports EXIT

# First load: drop inherited exports for keys listed in the file (omit key in file => unset).
unset_env_file_keys "$ENV_FILE"

# Load env file (only KEY=VALUE lines; do not paste shell commands here — `source` executes them.)
# Restore ENV_FILE after source so a stray ENV_FILE= in the file cannot override this script's path.
_DEPLOY_ENV_FILE="$ENV_FILE"
set -a
# shellcheck source=/dev/null
source "$_DEPLOY_ENV_FILE"
ENV_FILE="$_DEPLOY_ENV_FILE"
export ENV_FILE
set +a
unset _DEPLOY_ENV_FILE

if [ "$NETWORK" = "local" ]; then
  if [ -z "${FORK_RPC_URL:-}" ]; then
    echo "Error: FORK_RPC_URL must be set in $ENV_FILE (or exported in the shell) when using --network local."
    echo "  Set it to the HTTPS RPC URL of the chain where VIRTUAL_TOKEN_ADDRESS and other env addresses are deployed."
    exit 1
  fi
  export FORK_RPC_URL
  echo "Fork RPC: $FORK_RPC_URL"
  echo ""
fi

# Validate network and set hardhat network name
case "$NETWORK" in
    "local")
        HARDHAT_NETWORK="local"
        ;;
    "base_sepolia")
        HARDHAT_NETWORK="base_sepolia"
        ;;
    "base")
        HARDHAT_NETWORK="base"
        echo "⚠️  WARNING: Deploying to BASE MAINNET!"
        echo "Press Ctrl+C within 5 seconds to cancel..."
        sleep 5
        ;;
    "bsc_testnet")
        HARDHAT_NETWORK="bsc_testnet"
        ;;
    "abstract_testnet")
        HARDHAT_NETWORK="abstract_testnet"
        ;;
    "abstract_mainnet")
        HARDHAT_NETWORK="abstract_mainnet"
        echo "⚠️  WARNING: Deploying to ABSTRACT MAINNET!"
        echo "Press Ctrl+C within 5 seconds to cancel..."
        sleep 5
        ;;
    "monad_testnet")
        HARDHAT_NETWORK="monad_testnet"
        ;;
    "monad_mainnet")
        HARDHAT_NETWORK="monad_mainnet"
        ;;
    *)
        echo "Error: Unknown network '$NETWORK'"
        echo "Valid networks: local, base_sepolia, base, bsc_testnet, abstract_testnet, abstract_mainnet, monad_testnet"
        exit 1
        ;;
esac

echo "Hardhat network: $HARDHAT_NETWORK"
echo ""

# ============================================================================
# Helper Functions
# ============================================================================

# True if value looks like a deployed contract address (avoids skipping Uni deploy on empty/whitespace or stale exports).
is_eth_address_set() {
    local v="${1:-}"
    [[ "$v" =~ ^[[:space:]]*0x[a-fA-F0-9]{40}[[:space:]]*$ ]]
}

# Function to update env var in file
update_env_var() {
    local key=$1
    local value=$2
    local file=$3
    
    if grep -q "^${key}=" "$file"; then
        sed -i '' "s|^${key}=.*|${key}=${value}|" "$file"
    else
        echo "${key}=${value}" >> "$file"
    fi
}

# Function to extract and save addresses from log file
save_addresses_from_file() {
    local log_file="$1"
    
    while IFS= read -r line; do
        if echo "$line" | grep -q "AgentNftV2 deployed at:"; then
            addr=$(echo "$line" | grep -oE "0x[a-fA-F0-9]{40}")
            [ -n "$addr" ] && update_env_var "AGENT_NFT_V2_ADDRESS" "$addr" "$ENV_FILE" && echo "  -> AGENT_NFT_V2_ADDRESS=$addr"
        fi
        if echo "$line" | grep -q "AgentTaxV2 deployed at:"; then
            addr=$(echo "$line" | grep -oE "0x[a-fA-F0-9]{40}")
            if [ -n "$addr" ]; then
                update_env_var "AGENT_TAX_V2_CONTRACT_ADDRESS" "$addr" "$ENV_FILE" && echo "  -> AGENT_TAX_V2_CONTRACT_ADDRESS=$addr"
                update_env_var "FFactoryV3_TAX_VAULT" "$addr" "$ENV_FILE" && echo "  -> FFactoryV3_TAX_VAULT=$addr"
            fi
        fi
        if echo "$line" | grep -q "FFactoryV3 deployed at:"; then
            addr=$(echo "$line" | grep -oE "0x[a-fA-F0-9]{40}")
            [ -n "$addr" ] && update_env_var "FFactoryV3_ADDRESS" "$addr" "$ENV_FILE" && echo "  -> FFactoryV3_ADDRESS=$addr"
        fi
        if echo "$line" | grep -q "FRouterV3 deployed at:"; then
            addr=$(echo "$line" | grep -oE "0x[a-fA-F0-9]{40}")
            [ -n "$addr" ] && update_env_var "FRouterV3_ADDRESS" "$addr" "$ENV_FILE" && echo "  -> FRouterV3_ADDRESS=$addr"
        fi
        if echo "$line" | grep -q "AgentTokenV3 implementation deployed at:"; then
            addr=$(echo "$line" | grep -oE "0x[a-fA-F0-9]{40}")
            [ -n "$addr" ] && update_env_var "AGENT_TOKEN_V3_IMPLEMENTATION" "$addr" "$ENV_FILE" && echo "  -> AGENT_TOKEN_V3_IMPLEMENTATION=$addr"
        fi
        if echo "$line" | grep -q "AgentVeTokenV2 implementation deployed at:"; then
            addr=$(echo "$line" | grep -oE "0x[a-fA-F0-9]{40}")
            [ -n "$addr" ] && update_env_var "AGENT_VE_TOKEN_V2_IMPLEMENTATION" "$addr" "$ENV_FILE" && echo "  -> AGENT_VE_TOKEN_V2_IMPLEMENTATION=$addr"
        fi
        if echo "$line" | grep -q "AgentDAO implementation deployed at:"; then
            addr=$(echo "$line" | grep -oE "0x[a-fA-F0-9]{40}")
            [ -n "$addr" ] && update_env_var "AGENT_DAO_IMPLEMENTATION" "$addr" "$ENV_FILE" && echo "  -> AGENT_DAO_IMPLEMENTATION=$addr"
        fi
        if echo "$line" | grep -q "AgentFactoryV7 deployed at:"; then
            addr=$(echo "$line" | grep -oE "0x[a-fA-F0-9]{40}")
            [ -n "$addr" ] && update_env_var "AGENT_FACTORY_V7_ADDRESS" "$addr" "$ENV_FILE" && echo "  -> AGENT_FACTORY_V7_ADDRESS=$addr"
        fi
        if echo "$line" | grep -q "BondingConfig deployed at:"; then
            addr=$(echo "$line" | grep -oE "0x[a-fA-F0-9]{40}")
            [ -n "$addr" ] && update_env_var "BONDING_CONFIG_ADDRESS" "$addr" "$ENV_FILE" && echo "  -> BONDING_CONFIG_ADDRESS=$addr"
        fi
        if echo "$line" | grep -q "BondingV5 deployed at:"; then
            addr=$(echo "$line" | grep -oE "0x[a-fA-F0-9]{40}")
            [ -n "$addr" ] && update_env_var "BONDING_V5_ADDRESS" "$addr" "$ENV_FILE" && echo "  -> BONDING_V5_ADDRESS=$addr"
        fi
    done < "$log_file"
}

# Parses deployUniswapV2TestnetLiquidity.ts output (UNISWAP_V2_ROUTER= / AGENT_TAX_*= lines)
save_univ2_env_from_log() {
    local log_file="$1"
    while IFS= read -r line; do
        if echo "$line" | grep -qE '^UNISWAP_V2_ROUTER=0x[a-fA-F0-9]{40}$'; then
            val="${line#UNISWAP_V2_ROUTER=}"
            update_env_var "UNISWAP_V2_ROUTER" "$val" "$ENV_FILE" && echo "  -> UNISWAP_V2_ROUTER=$val"
        fi
        if echo "$line" | grep -qE '^AGENT_TAX_DEX_ROUTER=0x[a-fA-F0-9]{40}$'; then
            val="${line#AGENT_TAX_DEX_ROUTER=}"
            update_env_var "AGENT_TAX_DEX_ROUTER" "$val" "$ENV_FILE" && echo "  -> AGENT_TAX_DEX_ROUTER=$val"
        fi
        if echo "$line" | grep -qE '^AGENT_TAX_ASSET_TOKEN=0x[a-fA-F0-9]{40}$'; then
            val="${line#AGENT_TAX_ASSET_TOKEN=}"
            update_env_var "AGENT_TAX_ASSET_TOKEN" "$val" "$ENV_FILE" && echo "  -> AGENT_TAX_ASSET_TOKEN=$val"
        fi
    done < "$log_file"
}

run_univ2_liquidity_deploy() {
    case "$HARDHAT_NETWORK" in
        local|bsc_testnet|monad_testnet)
            ;;
        *)
            echo "Skipping deployUniswapV2TestnetLiquidity.ts (not run on network $HARDHAT_NETWORK)"
            echo ""
            return 0
            ;;
    esac

    # Re-source: clear keys listed in the file first so inherited/partial state cannot survive omitted keys.
    unset_env_file_keys "$ENV_FILE"

    _DEPLOY_ENV_FILE="$ENV_FILE"
    set -a
    # shellcheck source=/dev/null
    source "$_DEPLOY_ENV_FILE"
    ENV_FILE="$_DEPLOY_ENV_FILE"
    export ENV_FILE
    set +a
    unset _DEPLOY_ENV_FILE

    # Script only deploys Router/Factory/WETH when UNISWAP_V2_ROUTER is unset; only deploys mock ERC20 when AGENT_TAX_ASSET_TOKEN is unset.
    # Skip only when both are valid 0x addresses (empty lines like UNISWAP_V2_ROUTER= must NOT skip — use regex, not [ -n ]).
    if is_eth_address_set "${UNISWAP_V2_ROUTER:-}" && is_eth_address_set "${AGENT_TAX_ASSET_TOKEN:-}"; then
        echo "UNISWAP_V2_ROUTER and AGENT_TAX_ASSET_TOKEN already set (valid addresses) — skipping deployUniswapV2TestnetLiquidity.ts"
        echo ""
        return 0
    fi

    if ! is_eth_address_set "${AGENT_TAX_ASSET_TOKEN:-}"; then
        if [ "${LAUNCHPAD_AUTO_UNIV2:-}" = "1" ]; then
            echo "AGENT_TAX_ASSET_TOKEN not set; LAUNCHPAD_AUTO_UNIV2=1 — will run deployUniswapV2TestnetLiquidity.ts"
        elif [ -t 0 ]; then
            read -r -p "AGENT_TAX_ASSET_TOKEN is not set. Run deployUniswapV2TestnetLiquidity.ts (UniV2 + mock stable, and optional mock VIRTUAL via prompt in script)? [y/N] " _univ2_yn
            case "$_univ2_yn" in
                [Yy]|[Yy][Ee][Ss]) ;;
                *)
                    echo "Aborted. Set AGENT_TAX_ASSET_TOKEN (and UNISWAP_V2_ROUTER if reusing) in $ENV_FILE, or export LAUNCHPAD_AUTO_UNIV2=1 for non-interactive runs."
                    return 1
                    ;;
            esac
        else
            echo "Error: AGENT_TAX_ASSET_TOKEN is not set and stdin is not a TTY."
            echo "  Set AGENT_TAX_ASSET_TOKEN (and UNISWAP_V2_ROUTER if needed) in $ENV_FILE, or export LAUNCHPAD_AUTO_UNIV2=1 to run UniV2 deploy without prompting."
            return 1
        fi
    fi

    echo "========================================"
    echo "  Uniswap V2 + stable (AGENT_TAX_ASSET_TOKEN): deployUniswapV2TestnetLiquidity.ts"
    echo "  Network: $HARDHAT_NETWORK"
    echo "========================================"

    local log_file="/tmp/deploy_step_univ2.log"
    set +e
    ENV_FILE="$ENV_FILE" npx hardhat run "scripts/launchpadv5/deployUniswapV2TestnetLiquidity.ts" --network "$HARDHAT_NETWORK" 2>&1 | tee "$log_file"
    local exit_code=${PIPESTATUS[0]}
    set -e

    if [ $exit_code -ne 0 ]; then
        echo ""
        echo "deployUniswapV2TestnetLiquidity.ts failed with exit code $exit_code!"
        return 1
    fi

    echo ""
    echo "Saving UNISWAP_V2_ROUTER / AGENT_TAX_DEX_ROUTER / AGENT_TAX_ASSET_TOKEN to $ENV_FILE..."
    save_univ2_env_from_log "$log_file"
    echo ""
    return 0
}

# Function to start fork node (local network only)
start_fork_node() {
    if [ "$NETWORK" != "local" ]; then
        echo "Fork node is only needed for local network"
        return 0
    fi
    
    # Must match hardhat.config.js networks.hardhat.forking.url (FORK_RPC_URL first).
    local rpc_url="${FORK_RPC_URL:?FORK_RPC_URL is unset — fix env or run script from protocol-contracts after sourcing .env}"
    
    echo "Killing any existing hardhat node..."
    pkill -f "hardhat node" 2>/dev/null || true
    sleep 2
    
    echo "Starting local fork node..."
    echo "Fork RPC URL: $rpc_url"
    echo ""
    
    # Start fork node with FORK_ENABLED=true (hardhat.config reads FORK_RPC_URL)
    echo "Running: FORK_ENABLED=true FORK_RPC_URL=... npx hardhat node"
    FORK_ENABLED=true FORK_RPC_URL="$rpc_url" npx hardhat node &
    NODE_PID=$!
    
    # Wait for node to start
    echo "Waiting for node to start (PID: $NODE_PID)..."
    sleep 12
    
    # Check if node is running
    if ! kill -0 $NODE_PID 2>/dev/null; then
        echo "Failed to start fork node!"
        exit 1
    fi
    
    # Verify fork: VIRTUAL_TOKEN_ADDRESS from env must have contract code on this fork (chain must match env file).
    echo "Verifying fork (eth_getCode VIRTUAL_TOKEN_ADDRESS)..."
    local virt="${VIRTUAL_TOKEN_ADDRESS:-}"
    if [ -z "$virt" ]; then
        echo "ERROR: VIRTUAL_TOKEN_ADDRESS is not set in $ENV_FILE — cannot verify fork."
        kill $NODE_PID 2>/dev/null
        exit 1
    fi
    local payload
    payload=$(printf '{"jsonrpc":"2.0","method":"eth_getCode","params":["%s","latest"],"id":1}' "$virt")
    local code
    code=$(curl -s -X POST http://127.0.0.1:8545 \
        -H "Content-Type: application/json" \
        -d "$payload" \
        | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
    
    if [ "$code" = "0x" ] || [ -z "$code" ]; then
        echo "ERROR: No contract code at VIRTUAL_TOKEN_ADDRESS=$virt on this fork."
        echo "  Your env targets one chain but FORK_RPC_URL forks another (addresses are not portable across chains)."
        echo "  Fix: set FORK_RPC_URL to the RPC of the chain where those addresses are deployed,"
        echo "       or use an env file whose external addresses match the fork (e.g. Base Sepolia + Base addresses)."
        echo "Stopping node..."
        kill $NODE_PID 2>/dev/null
        exit 1
    fi
    
    echo "Fork verified — VIRTUAL_TOKEN_ADDRESS has code on forked chain."
    echo ""
    echo "Fork node started successfully!"
    echo ""
}

# Function to run a deployment script (with real-time output)
run_deploy_script() {
    local script_name=$1
    local step_num=$2
    local log_file="/tmp/deploy_step_${step_num}.log"
    
    echo "========================================"
    echo "  Running Step $step_num: $script_name"
    echo "  Network: $HARDHAT_NETWORK"
    echo "========================================"
    
    # Reload env file to get updated addresses (fresh source; same as run_univ2).
    unset_env_file_keys "$ENV_FILE"

    _DEPLOY_ENV_FILE="$ENV_FILE"
    set -a
    # shellcheck source=/dev/null
    source "$_DEPLOY_ENV_FILE"
    ENV_FILE="$_DEPLOY_ENV_FILE"
    export ENV_FILE
    set +a
    unset _DEPLOY_ENV_FILE

    # Run script with real-time output (tee to both console and file)
    set +e
    ENV_FILE="$ENV_FILE" npx hardhat run "scripts/launchpadv5/$script_name" --network "$HARDHAT_NETWORK" 2>&1 | tee "$log_file"
    local exit_code=${PIPESTATUS[0]}
    set -e
    
    if [ $exit_code -ne 0 ]; then
        echo ""
        echo "Step $step_num failed with exit code $exit_code!"
        return 1
    fi
    
    # Save addresses from log file
    echo ""
    echo "Saving deployed addresses to $ENV_FILE..."
    save_addresses_from_file "$log_file"
    echo ""
    
    return 0
}

# Function to deploy all contracts
deploy_all() {
    echo "Using env file: $ENV_FILE"
    echo "Deploying to: $HARDHAT_NETWORK"
    echo ""

    # Minimal UniV2 + mock stable; writes UNISWAP_V2_ROUTER, AGENT_TAX_DEX_ROUTER, AGENT_TAX_ASSET_TOKEN
    run_univ2_liquidity_deploy || exit 1
    
    # Run deployment scripts sequentially
    run_deploy_script "deployLaunchpadv5_0.ts" 0 || exit 1
    run_deploy_script "deployLaunchpadv5_1.ts" 1 || exit 1
    run_deploy_script "deployLaunchpadv5_2.ts" 2 || exit 1
    run_deploy_script "deployLaunchpadv5_3.ts" 3 || exit 1
    run_deploy_script "deployLaunchpadv5_4.ts" 4 || exit 1
    
    echo "========================================"
    echo "  All Deployments Complete!"
    echo "========================================"
    echo ""
    echo "Network: $NETWORK"
    echo "Deployed addresses saved to: $ENV_FILE"
    echo ""
    echo "Summary:"
    grep -E "^(UNISWAP_V2_ROUTER|AGENT_TAX_DEX_ROUTER|AGENT_TAX_ASSET_TOKEN|AGENT_NFT_V2_ADDRESS|AGENT_TAX_V2_CONTRACT_ADDRESS|FFactoryV3_ADDRESS|FRouterV3_ADDRESS|AGENT_FACTORY_V7_ADDRESS|BONDING_CONFIG_ADDRESS|BONDING_V5_ADDRESS)=" "$ENV_FILE"
}

# ============================================================================
# Main Execution
# ============================================================================
case "$COMMAND" in
    "deploy-only")
        echo "Deploy-only mode: no node restart"
        echo ""
        deploy_all
        ;;
    "node-only")
        if [ "$NETWORK" != "local" ]; then
            echo "Error: node-only is only valid for local network"
            exit 1
        fi
        echo "Node-only mode: starting fork node for interactive use"
        echo ""
        start_fork_node
        echo "Fork node is running. Run scripts manually with:"
        echo "  ./scripts/launchpadv5/run_local_deploy.sh 0"
        echo "  ./scripts/launchpadv5/run_local_deploy.sh 1"
        echo "  ./scripts/launchpadv5/run_local_deploy.sh 2"
        echo "  ./scripts/launchpadv5/run_local_deploy.sh 3"
        echo "  ./scripts/launchpadv5/run_local_deploy.sh 4"
        echo ""
        echo "Or deploy all at once:"
        echo "  ./scripts/launchpadv5/run_local_deploy.sh deploy-only"
        echo ""
        echo "To stop node: pkill -f 'hardhat node'"
        wait $NODE_PID
        ;;
    "0"|"1"|"2"|"3"|"4")
        echo "Running single step: $COMMAND"
        echo ""
        run_deploy_script "deployLaunchpadv5_$COMMAND.ts" "$COMMAND"
        ;;
    ""|"full"|"all")
        # Full deployment
        if [ "$NETWORK" = "local" ]; then
            echo "Full deployment mode (local): killing existing node, starting fork, deploying all"
            echo ""
            start_fork_node
            deploy_all
            echo ""
            echo "Fork node is still running in background (PID: $NODE_PID)"
            echo "To stop: pkill -f 'hardhat node'"
        else
            echo "Full deployment mode ($NETWORK): deploying all contracts"
            echo ""
            deploy_all
        fi
        echo ""
        echo "To re-run deployment:"
        echo "  ./scripts/launchpadv5/run_local_deploy.sh --network $NETWORK --env $ENV_FILE"
        ;;
    *)
        echo "Error: Unknown command '$COMMAND'"
        echo ""
        echo "Valid commands: (empty), deploy-only, node-only, 0, 1, 2, 3, 4"
        exit 1
        ;;
esac
