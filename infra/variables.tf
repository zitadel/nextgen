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

variable "postgres_instance_name" {
  description = "Cloud SQL PostgreSQL instance name"
  type        = string
  default     = "zitadel"
}

variable "postgres_database_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "zitadel"
}

variable "postgres_database_version" {
  description = "Cloud SQL PostgreSQL engine version"
  type        = string
  default     = "POSTGRES_17"
}

variable "postgres_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "postgres_edition" {
  description = "Cloud SQL edition"
  type        = string
  default     = "ENTERPRISE"

  validation {
    condition     = contains(["ENTERPRISE", "ENTERPRISE_PLUS"], var.postgres_edition)
    error_message = "postgres_edition must be ENTERPRISE or ENTERPRISE_PLUS."
  }
}

variable "postgres_availability_type" {
  description = "Cloud SQL availability type (ZONAL or REGIONAL)"
  type        = string
  default     = "ZONAL"
}

variable "postgres_disk_size_gb" {
  description = "Initial Cloud SQL disk size in GB"
  type        = number
  default     = 20
}

variable "postgres_disk_type" {
  description = "Cloud SQL disk type"
  type        = string
  default     = "PD_SSD"
}

variable "postgres_backup_start_time" {
  description = "UTC start time for automated Cloud SQL backups (HH:MM)"
  type        = string
  default     = "03:00"
}

variable "postgres_point_in_time_recovery_enabled" {
  description = "Enable PostgreSQL point-in-time recovery"
  type        = bool
  default     = true
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
  description = "Prevent accidental deletion of stateful resources"
  type        = bool
  default     = true
}
