#!/bin/bash
# Start all services for the x402 demo
# Order: x402 first (Bazaar queries it), then Bazaar, then Frontend
# Prerequisites: npm install in each directory, live facilitator at https://x402.org/facilitator

echo "🧹 Cleaning up old processes..."
lsof -ti:3001 -ti:3002 -ti:5173 2>/dev/null | sort -u | xargs kill -9 2>/dev/null
sleep 1

echo ""
echo "💰 Starting x402 Payment Server (port 3002)..."
cd "$(dirname "$0")/x402server" && node index.js &
sleep 2

echo ""
echo "🌐 Starting Bazaar Discovery Server (port 3001)..."
cd "$(dirname "$0")/mcpdiscovery" && node index.js &
sleep 2

echo ""
echo "🎨 Starting Frontend (port 5173)..."
cd "$(dirname "$0")/frontend" && npx vite --host &
sleep 3

echo ""
echo "✅ All services started!"
echo "   x402:       http://localhost:3002"
echo "   Bazaar:     http://localhost:3001"
echo "   Frontend:   http://localhost:5173"
