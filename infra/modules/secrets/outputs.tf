output "master_key_secret_id" {
  description = "Secret Manager ID holding the server master key"
  value       = google_secret_manager_secret.runtime["master_key"].secret_id
}

output "database_postgres_secret_id" {
  description = "Secret Manager ID holding the Postgres connection string"
  value       = google_secret_manager_secret.runtime["database_postgres"].secret_id
}
