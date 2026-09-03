variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "github_deploy_sa_email" {
  description = "Email of the github-deploy SA from the mgmt project (for impersonation bindings)"
  type        = string
}
