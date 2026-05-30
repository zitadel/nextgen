variable "project_id" {
  description = "GCP project ID"
  type        = string

  validation {
    condition     = !startswith(var.project_id, "REPLACE")
    error_message = "Replace the placeholder project_id in your tfvars file."
  }
}

variable "region" {
  description = "Primary GCP region for Cloud Run and Artifact Registry"
  type        = string
  default     = "us-central1"
}

variable "spanner_config" {
  description = "Spanner instance configuration (e.g. regional-us-central1)"
  type        = string
  default     = "regional-us-central1"
}

variable "spanner_processing_units" {
  description = "Spanner processing units (100 = minimum, 1000 = 1 node)"
  type        = number
  default     = 100
}

variable "spanner_instance_name" {
  description = "Spanner instance name"
  type        = string
  default     = "zitadel"
}

variable "spanner_database_name" {
  description = "Spanner database name"
  type        = string
  default     = "zitadel"
}

variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "base_domain" {
  description = "Base domain for the deployment (e.g. zitadel.example.com)"
  type        = string
}

variable "dns_zone_name" {
  description = "Cloud DNS managed zone name"
  type        = string
  default     = "zitadel"
}

variable "github_deploy_sa_email" {
  description = "Email of the github-deploy SA from the mgmt project"
  type        = string

  validation {
    condition     = !can(regex("REPLACE", var.github_deploy_sa_email))
    error_message = "Replace the placeholder github_deploy_sa_email in your tfvars file."
  }
}

variable "cloud_run_cpu" {
  description = "Cloud Run CPU allocation (e.g. 1, 2, 4)"
  type        = string
  default     = "1"
}

variable "cloud_run_memory" {
  description = "Cloud Run memory allocation (e.g. 512Mi, 1Gi)"
  type        = string
  default     = "512Mi"
}

variable "cloud_run_min_instances" {
  description = "Minimum Cloud Run instances (0 for dev, 1+ for prod)"
  type        = number
  default     = 0
}

variable "cloud_run_max_instances" {
  description = "Maximum Cloud Run instances"
  type        = number
  default     = 10
}

variable "cdn_enabled" {
  description = "Enable Cloud CDN on the load balancer"
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Prevent accidental deletion of stateful resources (Cloud Run service)"
  type        = bool
  default     = true
}
