# ── DNS record pointing root domain to Cloudflare Pages ─────────────────────
# Cloudflare handles CNAME flattening at the apex automatically when proxied.

resource "cloudflare_dns_record" "site" {
  zone_id = cloudflare_zone.main.id
  name    = var.domain_name
  type    = "CNAME"
  content = "${cloudflare_pages_project.site.name}.pages.dev"
  proxied = true
  ttl     = 1 # Auto TTL when proxied
}
