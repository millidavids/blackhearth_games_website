output "nameservers" {
  description = "Set these as your domain registrar's nameservers"
  value       = cloudflare_zone.main.name_servers
}

output "zone_id" {
  description = "Cloudflare zone ID for blackhearthgames.com"
  value       = cloudflare_zone.main.id
}

output "pages_project_name" {
  description = "Cloudflare Pages project name"
  value       = cloudflare_pages_project.site.name
}

output "pages_url" {
  description = "Pages dev URL"
  value       = "https://${cloudflare_pages_project.site.name}.pages.dev"
}

output "site_url" {
  description = "Live site URL"
  value       = "https://${var.domain_name}"
}
