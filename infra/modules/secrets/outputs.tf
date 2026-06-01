output "secret_refs" {
  description = "Map of secret short name to Cloud Run Secret Manager reference"
  value = {
    server_encryption_key = {
      secret_id = google_secret_manager_secret.server_encryption_key.secret_id
      version   = var.server_encryption_key_version
    }
    database_postgres = {
      secret_id = google_secret_manager_secret.database_postgres.secret_id
      version   = var.database_postgres_version
    }
  }
}
