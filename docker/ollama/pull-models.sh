#!/usr/bin/env bash
set -euo pipefail

OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11435}"
OLLAMA_MODEL="${OLLAMA_MODEL:-all-minilm}"

echo "Waiting for Ollama to be ready..."
until curl -sf "$OLLAMA_HOST/api/tags" > /dev/null 2>&1; do
  sleep 2
done
echo "Ollama is ready."

echo "Pulling $OLLAMA_MODEL (embeddings)..."
curl -sf "$OLLAMA_HOST/api/pull" -d "{\"name\": \"$OLLAMA_MODEL\"}" | while read -r line; do
  status=$(echo "$line" | grep -o '"status":"[^"]*"' | head -1)
  [ -n "$status" ] && echo "  $status"
done
echo "$OLLAMA_MODEL pulled successfully."

echo "All models ready."
