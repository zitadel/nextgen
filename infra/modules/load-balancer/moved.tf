# Preserve state when renaming resources — prevents destroy+recreate cycles.
# These blocks can be removed after all environments have been applied once.

moved {
  from = google_compute_global_address.default
  to   = google_compute_global_address.ipv4
}

moved {
  from = google_compute_global_forwarding_rule.https
  to   = google_compute_global_forwarding_rule.https_ipv4
}

moved {
  from = google_compute_global_forwarding_rule.http_redirect
  to   = google_compute_global_forwarding_rule.http_redirect_ipv4
}
