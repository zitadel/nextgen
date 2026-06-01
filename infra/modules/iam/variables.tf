variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "github_deploy_sa_email" {
  description = "Email of the github-deploy SA from the mgmt project (for impersonation bindings)"
  type        = string
}

variable "secret_refs" {
  description = "Secret Manager references keyed by runtime secret name."
  type = map(object({
    secret_id = string
    version   = string
  }))
  default = {}
}
