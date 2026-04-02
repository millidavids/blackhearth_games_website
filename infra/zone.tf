# ── Cloudflare DNS Zone ──────────────────────────────────────────────────────
# Authoritative zone for blackhearthgames.com, managed here since this is the
# root domain site. Other sites (e.g. court_wizard_website) reference this
# zone via data source.
#
# After applying, update your domain registrar's nameservers to the values
# from the "nameservers" output.

resource "cloudflare_zone" "main" {
  account = {
    id = var.cloudflare_account_id
  }
  name = var.domain_name
  type = "full"
}
