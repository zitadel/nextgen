output "service_name" {
  value = google_cloud_run_v2_service.zitadel.name
}

output "service_uri" {
  value = google_cloud_run_v2_service.zitadel.uri
}

output "migrate_job_name" {
  value = google_cloud_run_v2_job.migrate.name
}
