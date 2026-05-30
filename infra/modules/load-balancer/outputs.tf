output "ipv4_address" {
  value = google_compute_global_address.ipv4.address
}

output "ipv6_address" {
  value = google_compute_global_address.ipv6.address
}

output "url_map_name" {
  value = google_compute_url_map.default.name
}

output "backend_service_name" {
  value = google_compute_backend_service.default.name
}
