#!/bin/bash
# scripts/start_fork.sh

if [ -z "$ETH_RPC_URL" ]; then
  echo "❌ Error: ETH_RPC_URL variable is not set."
  echo "👉 Usage example:"
  echo "   export ETH_RPC_URL='https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY'"
  echo "   ./scripts/start_fork.sh"
  exit 1
fi

echo "🚀 Starting Anvil Fork from Mainnet..."
echo "📡 Upstream RPC: $ETH_RPC_URL"

anvil \
    --fork-url $ETH_RPC_URL \
    --port 8545 \
    --accounts 10 \
    --balance 10000