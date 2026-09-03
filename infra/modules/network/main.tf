resource "google_compute_network" "default" {
  name                    = "zitadel-${var.environment}"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "cloud_run" {
  name          = "zitadel-run-${var.environment}"
  network       = google_compute_network.default.id
  region        = var.region
  ip_cidr_range = var.subnet_cidr
}

resource "google_compute_address" "nat" {
  name   = "zitadel-nat-${var.environment}"
  region = var.region
}

resource "google_compute_router" "default" {
  name    = "zitadel-router-${var.environment}"
  network = google_compute_network.default.id
  region  = var.region
}

resource "google_compute_router_nat" "default" {
  name                               = "zitadel-nat-${var.environment}"
  router                             = google_compute_router.default.name
  region                             = var.region
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = [google_compute_address.nat.self_link]
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.cloud_run.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }
}
