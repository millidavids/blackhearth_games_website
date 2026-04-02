#!/usr/bin/env bash
# Manual deploy to Cloudflare Pages.
# Requires: wrangler (npm install -g wrangler)
# Usage: ./scripts/deploy.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

PROJECT=$(cd infra && tofu output -raw pages_project_name)

mkdir -p _site
cp -r index.html css js images _site/

echo "Deploying to Cloudflare Pages project: ${PROJECT}..."
npx wrangler pages deploy _site --project-name="${PROJECT}"

rm -rf _site
echo "Done. Site: https://blackhearthgames.com"
