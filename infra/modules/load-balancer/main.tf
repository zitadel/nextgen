resource "google_compute_global_address" "ipv4" {
  name       = "zitadel-ip-${var.environment}"
  ip_version = "IPV4"
}

resource "google_compute_global_address" "ipv6" {
  name       = "zitadel-ipv6-${var.environment}"
  ip_version = "IPV6"
}

resource "google_compute_region_network_endpoint_group" "serverless" {
  name                  = "zitadel-neg-${var.environment}"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = var.cloud_run_service_name
  }
}

resource "google_compute_backend_service" "default" {
  name                  = "zitadel-backend-${var.environment}"
  protocol              = "HTTPS"
  port_name             = "http"
  timeout_sec           = 30
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.serverless.id
  }

  log_config {
    enable      = true
    sample_rate = 0.1
  }
}

resource "google_compute_backend_service" "cacheable" {
  name                  = "zitadel-cacheable-backend-${var.environment}"
  protocol              = "HTTPS"
  port_name             = "http"
  timeout_sec           = 30
  load_balancing_scheme = "EXTERNAL_MANAGED"

  enable_cdn = var.cdn_enabled

  dynamic "cdn_policy" {
    for_each = var.cdn_enabled ? [1] : []
    content {
      cache_mode       = "USE_ORIGIN_HEADERS"
      negative_caching = false

      cache_key_policy {
        include_host         = true
        include_protocol     = true
        include_query_string = true
      }
    }
  }

  backend {
    group = google_compute_region_network_endpoint_group.serverless.id
  }

  log_config {
    enable      = true
    sample_rate = 0.1
  }
}

resource "google_compute_url_map" "default" {
  name            = "zitadel-lb-${var.environment}"
  default_service = google_compute_backend_service.default.id

  host_rule {
    hosts        = ["*"]
    path_matcher = "app"
  }

  path_matcher {
    name            = "app"
    default_service = google_compute_backend_service.default.id

    path_rule {
      paths = [
        "/.well-known/openid-configuration",
        "/assets/*",
        "/keys",
      ]
      service = google_compute_backend_service.cacheable.id
    }
  }
}

resource "google_compute_target_https_proxy" "default" {
  name            = "zitadel-https-${var.environment}"
  url_map         = google_compute_url_map.default.id
  certificate_map = "//certificatemanager.googleapis.com/${var.certificate_map_id}"
}

# HTTPS — IPv4
resource "google_compute_global_forwarding_rule" "https_ipv4" {
  name                  = "zitadel-https-fwd-${var.environment}"
  target                = google_compute_target_https_proxy.default.id
  ip_address            = google_compute_global_address.ipv4.address
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# HTTPS — IPv6
resource "google_compute_global_forwarding_rule" "https_ipv6" {
  name                  = "zitadel-https6-fwd-${var.environment}"
  target                = google_compute_target_https_proxy.default.id
  ip_address            = google_compute_global_address.ipv6.address
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# HTTP → HTTPS redirect
resource "google_compute_url_map" "http_redirect" {
  name = "zitadel-http-redirect-${var.environment}"

  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "zitadel-http-redirect-${var.environment}"
  url_map = google_compute_url_map.http_redirect.id
}

# HTTP redirect — IPv4
resource "google_compute_global_forwarding_rule" "http_redirect_ipv4" {
  name                  = "zitadel-http-fwd-${var.environment}"
  target                = google_compute_target_http_proxy.redirect.id
  ip_address            = google_compute_global_address.ipv4.address
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# HTTP redirect — IPv6
resource "google_compute_global_forwarding_rule" "http_redirect_ipv6" {
  name                  = "zitadel-http6-fwd-${var.environment}"
  target                = google_compute_target_http_proxy.redirect.id
  ip_address            = google_compute_global_address.ipv6.address
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
}
