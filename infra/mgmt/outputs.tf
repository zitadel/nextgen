output "artifact_registry_url" {
  description = "Docker repository URL for pushing images"
  value       = "${var.region}-docker.pkg.dev/${var.mgmt_project_id}/${google_artifact_registry_repository.zitadel.repository_id}"
}

output "infra_apply_sa_email" {
  description = "Service account email for infrastructure CI (GitHub Actions)"
  value       = google_service_account.infra_apply.email
}

output "github_deploy_sa_email" {
  description = "Service account email for app deployment (GitHub Actions)"
  value       = google_service_account.github_deploy.email
}

output "wif_provider" {
  description = "WIF provider resource name (for GitHub Actions auth)"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "state_bucket" {
  description = "GCS bucket name for OpenTofu state"
  value       = "${var.mgmt_project_id}-tofu-state"
}
