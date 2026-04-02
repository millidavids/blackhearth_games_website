# Blackhearth Games Website

Studio website for [Blackhearth Games](https://blackhearthgames.com). Vanilla HTML/CSS/JS.

## Local Development

```bash
python3 serve.py
# Open http://localhost:8001
```

## Infrastructure

Hosted on Cloudflare Pages. Infrastructure managed with OpenTofu.

```bash
cd infra
export CLOUDFLARE_API_TOKEN="your-token"
tofu init
tofu apply -var="cloudflare_account_id=YOUR_ACCOUNT_ID"
```

This repo owns the `blackhearthgames.com` DNS zone. Apply this infra before any subdomain sites.

## Deploy

Pushes to `main` automatically deploy via GitHub Actions.

Manual deploy:

```bash
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
./scripts/deploy.sh
```
