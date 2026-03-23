#!/bin/bash
# Deployment Script for V5 Suite
# 
# This script runs deployment scripts 0-4 sequentially.
#
# ============================================================================
# CONFIGURATION (edit these defaults or pass via command line)
# ============================================================================
DEFAULT_NETWORK="local"                    # local, base_sepolia, base
DEFAULT_ENV_FILE=".env.launchpadv5_local"  # .env.launchpadv5_local, .env.launchpadv5_dev, .env.launchpadv5_prod
# ============================================================================
#
# Usage (from protocol-contracts directory):
#   ./scripts/launchpadv5/run_local_deploy.sh                          # Use defaults above
#   ./scripts/launchpadv5/run_local_deploy.sh --network base_sepolia   # Override network
#   ./scripts/launchpadv5/run_local_deploy.sh --env .env.launchpadv5_dev  # Override env file
#   ./scripts/launchpadv5/run_local_deploy.sh --network base_sepolia --env .env.launchpadv5_dev
#
# Commands (after network/env args):
#   (none)        # Full deploy: for local, kills node and starts fork; deploys all (0-3)
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
# Networks:
#   local         - Fork base_sepolia locally (requires BASE_SEPOLIA_RPC_URL in env)
#   base_sepolia  - Deploy directly to Base Sepolia testnet
#   base          - Deploy directly to Base mainnet (use with caution!)

set -e

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

# Load env file
set -a
source "$ENV_FILE"
set +a

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
    *)
        echo "Error: Unknown network '$NETWORK'"
        echo "Valid networks: local, base_sepolia, base"
        exit 1
        ;;
esac

echo "Hardhat network: $HARDHAT_NETWORK"
echo ""

# ============================================================================
# Helper Functions
# ============================================================================

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

# Function to clear deployed addresses
clear_deployed_addresses() {
    echo "Clearing previously deployed addresses in $ENV_FILE..."
    local keys=(
        "AGENT_NFT_V2_ADDRESS"
        "AGENT_TAX_V2_CONTRACT_ADDRESS"
        "FFactoryV3_TAX_VAULT"
        "FFactoryV3_ADDRESS"
        "FRouterV3_ADDRESS"
        "AGENT_TOKEN_V3_IMPLEMENTATION"
        "AGENT_VE_TOKEN_V2_IMPLEMENTATION"
        "AGENT_DAO_IMPLEMENTATION"
        "AGENT_FACTORY_V7_ADDRESS"
        "BONDING_CONFIG_ADDRESS"
        "BONDING_V5_ADDRESS"
    )
    
    for key in "${keys[@]}"; do
        update_env_var "$key" "" "$ENV_FILE"
    done
    echo "Done."
    echo ""
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

# Function to start fork node (local network only)
start_fork_node() {
    if [ "$NETWORK" != "local" ]; then
        echo "Fork node is only needed for local network"
        return 0
    fi
    
    # Get RPC URL from env (already loaded)
    local rpc_url="${BASE_SEPOLIA_RPC_URL:-https://base-sepolia.drpc.org}"
    
    echo "Killing any existing hardhat node..."
    pkill -f "hardhat node" 2>/dev/null || true
    sleep 2
    
    echo "Starting local fork node..."
    echo "RPC URL: $rpc_url"
    echo ""
    
    # Start fork node with FORK_ENABLED=true
    echo "Running: FORK_ENABLED=true BASE_SEPOLIA_RPC_URL=... npx hardhat node"
    FORK_ENABLED=true BASE_SEPOLIA_RPC_URL="$rpc_url" npx hardhat node &
    NODE_PID=$!
    
    # Wait for node to start
    echo "Waiting for node to start (PID: $NODE_PID)..."
    sleep 12
    
    # Check if node is running
    if ! kill -0 $NODE_PID 2>/dev/null; then
        echo "Failed to start fork node!"
        exit 1
    fi
    
    # Verify fork is working
    echo "Verifying fork..."
    local code=$(curl -s -X POST http://127.0.0.1:8545 \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0xbfAB80ccc15DF6fb7185f9498d6039317331846a", "latest"],"id":1}' \
        | grep -o '"result":"[^"]*"' | cut -d'"' -f4 | head -c 10)
    
    if [ "$code" = "0x" ] || [ -z "$code" ]; then
        echo "ERROR: Fork not working! VIRTUAL token not found."
        echo "Stopping node..."
        kill $NODE_PID 2>/dev/null
        exit 1
    fi
    
    echo "Fork verified - VIRTUAL token exists!"
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
    
    # Reload env file to get updated addresses
    set -a
    source "$ENV_FILE"
    set +a
    
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
    
    # Clear addresses first
    clear_deployed_addresses
    
    # Run deployment scripts sequentially
    run_deploy_script "deployLaunchpadv5_0.ts" 0 || exit 1
    run_deploy_script "deployLaunchpadv5_1.ts" 1 || exit 1
    run_deploy_script "deployLaunchpadv5_2.ts" 2 || exit 1
    run_deploy_script "deployLaunchpadv5_3.ts" 3 || exit 1
    
    echo "========================================"
    echo "  All Deployments Complete!"
    echo "========================================"
    echo ""
    echo "Network: $NETWORK"
    echo "Deployed addresses saved to: $ENV_FILE"
    echo ""
    echo "Summary:"
    grep -E "^(AGENT_NFT_V2_ADDRESS|AGENT_TAX_V2_CONTRACT_ADDRESS|FFactoryV3_ADDRESS|FRouterV3_ADDRESS|AGENT_FACTORY_V7_ADDRESS|BONDING_CONFIG_ADDRESS|BONDING_V5_ADDRESS)=" "$ENV_FILE"
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
