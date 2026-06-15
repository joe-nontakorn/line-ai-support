#!/bin/bash

# Test API Config Endpoints
echo "========== Testing AI Config API =========="

# 1. Get current config
echo ""
echo "1. GET /api/ai-config/current"
curl -s http://localhost:3002/api/ai-config/current | jq .

# 2. Get available providers
echo ""
echo "2. GET /api/ai-config/providers"
curl -s http://localhost:3002/api/ai-config/providers | jq .

# 3. Get models for gemini
echo ""
echo "3. GET /api/ai-config/models/gemini"
curl -s http://localhost:3002/api/ai-config/models/gemini | jq .

# 4. Get models for openrouter
echo ""
echo "4. GET /api/ai-config/models/openrouter"
curl -s http://localhost:3002/api/ai-config/models/openrouter | jq .

# 5. Test connection (Gemini)
echo ""
echo "5. POST /api/ai-config/test (Gemini)"
curl -s -X POST http://localhost:3002/api/ai-config/test \
  -H "Content-Type: application/json" \
  -d '{"provider":"gemini","model":"gemini-3.1-flash-lite-preview"}' | jq .

# 6. Update provider to Gemini
echo ""
echo "6. POST /api/ai-config/update (Gemini)"
curl -s -X POST http://localhost:3002/api/ai-config/update \
  -H "Content-Type: application/json" \
  -d '{"provider":"gemini","model":"gemini-3.1-flash-lite-preview"}' | jq .

echo ""
echo "========== Done =========="
