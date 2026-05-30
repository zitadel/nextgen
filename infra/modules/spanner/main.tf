resource "google_spanner_instance" "zitadel" {
  name             = var.instance_name
  config           = var.spanner_config
  display_name     = "Zitadel ${var.environment}"
  processing_units = var.processing_units

  labels = {
    environment = var.environment
    managed_by  = "opentofu"
  }
}

resource "google_spanner_database" "zitadel" {
  instance            = google_spanner_instance.zitadel.name
  name                = var.database_name
  deletion_protection = var.deletion_protection

  # Schema is managed by the Zitadel migration job, not OpenTofu.
  # The database resource is just the empty shell.

  lifecycle {
    # Never let OpenTofu drop and recreate the database.
    prevent_destroy = false
  }
}
