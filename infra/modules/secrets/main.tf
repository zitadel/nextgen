# ─────────────────────────────────────────────────────────────────────────────
# Secret Manager secrets for Zitadel runtime configuration.
#
# OpenTofu owns the secret containers only. Secret values are created and
# rotated directly in Google Secret Manager so values never enter source
# control or OpenTofu state.
# ─────────────────────────────────────────────────────────────────────────────

resource "google_secret_manager_secret" "server_encryption_key" {
  secret_id = "zitadel-encryption-key-secret-${var.environment}"
  project   = var.project_id

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_secret_manager_secret" "database_postgres" {
  secret_id = "zitadel-database-postgres-secret-${var.environment}"
  project   = var.project_id

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }
}
