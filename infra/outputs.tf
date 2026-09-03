output "postgres_instance_name" {
  description = "Cloud SQL PostgreSQL instance name"
  value       = module.postgres.instance_name
}

output "postgres_connection_name" {
  description = "Cloud SQL PostgreSQL instance connection name"
  value       = module.postgres.connection_name
}

output "postgres_database_name" {
  description = "PostgreSQL database name"
  value       = module.postgres.database_name
}

output "postgres_private_ip" {
  description = "Private IP for direct VPC PostgreSQL connections"
  value       = module.postgres.private_ip_address
}

output "cloud_run_service_name" {
  description = "Cloud Run service name"
  value       = module.cloud_run.service_name
}

output "cloud_run_migrate_job_name" {
  description = "Cloud Run migration job name"
  value       = module.cloud_run.migrate_job_name
}

output "load_balancer_ipv4" {
  description = "Global static IPv4 address for the load balancer"
  value       = module.load_balancer.ipv4_address
}

output "load_balancer_ipv6" {
  description = "Global static IPv6 address for the load balancer"
  value       = module.load_balancer.ipv6_address
}

output "dns_name_servers" {
  description = "Name servers for the DNS zone (delegate your domain to these)"
  value       = module.dns.name_servers
}

output "certificate_map_name" {
  description = "Certificate Manager map name (runtime infra.rs populates entries)"
  value       = module.certificate_map.map_name
}

output "url_map_name" {
  description = "GLB URL map name (runtime infra.rs adds host rules)"
  value       = module.load_balancer.url_map_name
}

output "backend_service_name" {
  description = "GLB backend service name (referenced by cloud.gcp config)"
  value       = module.load_balancer.backend_service_name
}

output "nat_ip" {
  description = "Static outbound IP for Cloud Run egress (allowlisting)"
  value       = module.network.nat_ip
}

output "master_key_secret_id" {
  description = "Secret Manager ID holding the server master key (value supplied by CI)"
  value       = module.secrets.master_key_secret_id
}

output "database_postgres_secret_id" {
  description = "Secret Manager ID holding the Postgres connection string (value supplied by CI)"
  value       = module.secrets.database_postgres_secret_id
}
