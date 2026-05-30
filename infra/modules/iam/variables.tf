variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "spanner_instance_name" {
  description = "Spanner instance name for IAM bindings"
  type        = string
}

variable "spanner_database_name" {
  description = "Spanner database name for IAM bindings"
  type        = string
}

variable "github_deploy_sa_email" {
  description = "Email of the github-deploy SA from the mgmt project (for impersonation bindings)"
  type        = string
}

variable "secret_ids" {
  description = "Map of secret short name to Secret Manager secret ID (for IAM bindings)"
  type        = map(string)
  default     = {}
}
