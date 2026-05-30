output "instance_name" {
  description = "Spanner instance name"
  value       = google_spanner_instance.zitadel.name
}

output "database_id" {
  description = "Full Spanner database resource name (projects/P/instances/I/databases/D)"
  value       = "projects/${google_spanner_instance.zitadel.project}/instances/${google_spanner_instance.zitadel.name}/databases/${google_spanner_database.zitadel.name}"
}

output "database_name" {
  description = "Spanner database name"
  value       = google_spanner_database.zitadel.name
}
