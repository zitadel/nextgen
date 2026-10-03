variable "environment" {
  type = string
}

variable "base_domain" {
  description = "Platform issuer domain (e.g. dev.zitadel.io). Used for the baseline managed cert covering the apex and *.<base_domain>."
  type        = string
}
