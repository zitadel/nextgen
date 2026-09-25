output "instance_name" {
  description = "Cloud SQL PostgreSQL instance name"
  value       = google_sql_database_instance.zitadel.name
}

output "connection_name" {
  description = "Cloud SQL instance connection name"
  value       = google_sql_database_instance.zitadel.connection_name
}

output "database_name" {
  description = "PostgreSQL database name"
  value       = google_sql_database.zitadel.name
}

output "private_ip_address" {
  description = "Private IP address for direct VPC PostgreSQL connections"
  value       = google_sql_database_instance.zitadel.private_ip_address
}
