#!/usr/bin/env bash
# Build a clean Chrome Web Store package: a versioned .zip containing ONLY the
# runtime files (no tests, tooling, docs, or VCS files). Uses an explicit
# allowlist so nothing extra can leak into the upload.
#
# Usage: bash scripts/package.sh   (or: npm run package)
set -euo pipefail

# Move to the repo root regardless of where the script is called from.
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./manifest.json').version")"
OUT_DIR="dist"
ZIP="${OUT_DIR}/a11y-state-contrast-checker-v${VERSION}.zip"

# The only files that ship inside the extension.
FILES=(
  manifest.json
  background.js
  page-functions.js
  popup.html
  popup.css
  popup.js
  icons/icon16.png
  icons/icon32.png
  icons/icon48.png
  icons/icon128.png
)

# Fail early if anything referenced is missing.
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "ERROR: missing runtime file: $f" >&2; exit 1; }
done

mkdir -p "$OUT_DIR"
rm -f "$ZIP"
zip -q -X "$ZIP" "${FILES[@]}"

echo "Created ${ZIP} (v${VERSION})"
echo "Contents:"
unzip -l "$ZIP"
