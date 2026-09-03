variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, prod, ...)"
  type        = string
}

variable "run_sa_email" {
  description = "Runtime service account that reads the secrets at container start"
  type        = string
}

variable "github_deploy_sa_email" {
  description = "Email of the github-deploy SA from the mgmt project; adds secret versions during deploy"
  type        = string
}
