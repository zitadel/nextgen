resource "google_certificate_manager_certificate_map" "default" {
  name        = "zitadel-cert-map-${var.environment}"
  description = "Certificate map for Zitadel ${var.environment}. Baseline entries (apex + wildcard) are managed by Terraform; customer custom-domain entries are added at runtime by the platform service."
}

# ─── Baseline platform certificates ──────────────────────────────────────────
# The platform needs TLS for its own issuer domain from day one, before any
# customer runtime provisioning runs. Terraform owns these entries; runtime
# only ever adds customer custom-domain entries with different names.

resource "google_certificate_manager_dns_authorization" "baseline" {
  name        = "zitadel-baseline-auth-${var.environment}"
  description = "DNS-01 authorization for ${var.base_domain}; covers apex and *.${var.base_domain}."
  domain      = var.base_domain
}

resource "google_certificate_manager_certificate" "baseline" {
  name        = "zitadel-baseline-cert-${var.environment}"
  description = "Baseline cert for ${var.base_domain} and *.${var.base_domain}."

  managed {
    domains = [
      var.base_domain,
      "*.${var.base_domain}",
    ]
    dns_authorizations = [
      google_certificate_manager_dns_authorization.baseline.id,
    ]
  }
}

resource "google_certificate_manager_certificate_map_entry" "baseline_apex" {
  name         = "zitadel-baseline-apex-${var.environment}"
  description  = "Apex baseline entry for ${var.base_domain}."
  map          = google_certificate_manager_certificate_map.default.name
  hostname     = var.base_domain
  certificates = [google_certificate_manager_certificate.baseline.id]
}

resource "google_certificate_manager_certificate_map_entry" "baseline_wildcard" {
  name         = "zitadel-baseline-wildcard-${var.environment}"
  description  = "Wildcard baseline entry for *.${var.base_domain}."
  map          = google_certificate_manager_certificate_map.default.name
  hostname     = "*.${var.base_domain}"
  certificates = [google_certificate_manager_certificate.baseline.id]
}
