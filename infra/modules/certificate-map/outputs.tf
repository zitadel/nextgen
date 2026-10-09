output "map_id" {
  value = google_certificate_manager_certificate_map.default.id
}

output "map_name" {
  value = google_certificate_manager_certificate_map.default.name
}

# DNS-01 challenge records for any Certificate Manager DNS authorizations in
# this module, keyed by a static name so consumers can use for_each without
# hitting "unknown keys at plan time". Values are resolved at apply time.
output "dns_challenge_records" {
  description = "DNS records that must exist for baseline managed certs to validate."
  value = {
    baseline = {
      name = google_certificate_manager_dns_authorization.baseline.dns_resource_record[0].name
      type = google_certificate_manager_dns_authorization.baseline.dns_resource_record[0].type
      data = google_certificate_manager_dns_authorization.baseline.dns_resource_record[0].data
    }
  }
}
