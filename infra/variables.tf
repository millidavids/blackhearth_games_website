variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "domain_name" {
  description = "Root domain for the studio website"
  type        = string
  default     = "blackhearthgames.com"
}

variable "pages_project_name" {
  description = "Cloudflare Pages project name"
  type        = string
  default     = "blackhearth-games-website"
}

variable "github_owner" {
  description = "GitHub repository owner"
  type        = string
  default     = "millidavids"
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "blackhearth_games_website"
}
