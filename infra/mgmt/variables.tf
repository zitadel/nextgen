variable "mgmt_project_id" {
  description = "GCP project ID for the management project (zitadel-ops)"
  type        = string
}

variable "region" {
  description = "Primary GCP region"
  type        = string
  default     = "us-central1"
}

variable "github_repo" {
  description = "GitHub repository in owner/repo format"
  type        = string
}

variable "env_project_ids" {
  description = "Map of environment name to GCP project ID (e.g. { dev = \"zitadel-dev\" })"
  type        = map(string)
}
