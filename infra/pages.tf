# ── Cloudflare Pages Project ─────────────────────────────────────────────────
# Static site deployed via wrangler in GitHub Actions.

resource "cloudflare_pages_project" "site" {
  account_id        = var.cloudflare_account_id
  name              = var.pages_project_name
  production_branch = "main"
}

# ── Custom Domain ───────────────────────────────────────────────────────────

resource "cloudflare_pages_domain" "site" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.site.name
  name         = var.domain_name
}
