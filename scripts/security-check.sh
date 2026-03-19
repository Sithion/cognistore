#!/usr/bin/env bash
# Pre-commit security check: scans staged files for potential secrets/private data leaks

set -euo pipefail

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || echo "")

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

FOUND=0

PATTERNS=(
  'PRIVATE.KEY'
  'BEGIN RSA PRIVATE KEY'
  'BEGIN OPENSSH PRIVATE KEY'
  'sk-[a-zA-Z0-9]{20,}'
  'ghp_[a-zA-Z0-9]{36}'
  'gho_[a-zA-Z0-9]{36}'
  'glpat-[a-zA-Z0-9-]{20,}'
  'xoxb-[0-9]{10,}'
  'xoxp-[0-9]{10,}'
  'AKIA[0-9A-Z]{16}'
  'password\s*[:=]\s*"[^"]{4,}"'
  'secret\s*[:=]\s*"[^"]{4,}"'
  'api[_-]?key\s*[:=]\s*"[^"]{8,}"'
  'mongodb(\+srv)?://[^@]+@'
  'postgres(ql)?://[^@]+@'
)

for file in $STAGED_FILES; do
  case "$file" in
    *.lock|*.png|*.jpg|*.ico|*.woff*|*.db|*.sig|*.dmg|*/security-check.sh)
      continue ;;
  esac
  [ ! -f "$file" ] && continue

  for pattern in "${PATTERNS[@]}"; do
    if grep -qiE "$pattern" "$file" 2>/dev/null; then
      echo "[SECURITY] Potential secret in $file matching: $pattern"
      FOUND=1
    fi
  done
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "[SECURITY] Review flagged files. Bypass with --no-verify if false positive."
  exit 1
fi
exit 0
