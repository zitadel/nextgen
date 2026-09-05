resource "google_dns_managed_zone" "default" {
  name        = var.zone_name
  dns_name    = "${var.base_domain}."
  description = "Zitadel ${var.environment} DNS zone"
  visibility  = "public"
}

# IPv4
resource "google_dns_record_set" "a" {
  managed_zone = google_dns_managed_zone.default.name
  name         = "${var.base_domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [var.lb_ipv4_address]
}

resource "google_dns_record_set" "wildcard_a" {
  managed_zone = google_dns_managed_zone.default.name
  name         = "*.${var.base_domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [var.lb_ipv4_address]
}

# IPv6
resource "google_dns_record_set" "aaaa" {
  managed_zone = google_dns_managed_zone.default.name
  name         = "${var.base_domain}."
  type         = "AAAA"
  ttl          = 300
  rrdatas      = [var.lb_ipv6_address]
}

resource "google_dns_record_set" "wildcard_aaaa" {
  managed_zone = google_dns_managed_zone.default.name
  name         = "*.${var.base_domain}."
  type         = "AAAA"
  ttl          = 300
  rrdatas      = [var.lb_ipv6_address]
}

# ─── Certificate Manager DNS-01 challenge records ────────────────────────────
# Certificate Manager validates managed certificates by checking CNAME records
# under _acme-challenge.<domain>. Because we already own the zone here, we
# publish the challenge inline instead of requiring a manual DNS step.
resource "google_dns_record_set" "cert_challenge" {
  for_each = var.cert_challenge_records

  managed_zone = google_dns_managed_zone.default.name
  name         = each.value.name
  type         = each.value.type
  ttl          = 300
  rrdatas      = [each.value.data]
}
