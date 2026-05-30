output "network_id" {
  value = google_compute_network.default.id
}

output "subnet_id" {
  value = google_compute_subnetwork.cloud_run.id
}

output "nat_ip" {
  description = "Static outbound IP for Cloud Run egress"
  value       = google_compute_address.nat.address
}
