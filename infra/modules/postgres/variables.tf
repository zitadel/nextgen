variable "instance_name" {
  description = "Cloud SQL PostgreSQL instance name"
  type        = string
}

variable "database_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "zitadel"
}

variable "database_version" {
  description = "Cloud SQL PostgreSQL engine version"
  type        = string
  default     = "POSTGRES_17"
}

variable "tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "edition" {
  description = "Cloud SQL edition"
  type        = string
  default     = "ENTERPRISE"

  validation {
    condition     = contains(["ENTERPRISE", "ENTERPRISE_PLUS"], var.edition)
    error_message = "Cloud SQL edition must be ENTERPRISE or ENTERPRISE_PLUS."
  }
}

variable "region" {
  description = "Cloud SQL region"
  type        = string
}

variable "environment" {
  description = "Environment label"
  type        = string
}

variable "network_id" {
  description = "VPC network ID for private Cloud SQL access"
  type        = string
}

variable "availability_type" {
  description = "Cloud SQL availability type (ZONAL or REGIONAL)"
  type        = string
  default     = "ZONAL"
}

variable "disk_size_gb" {
  description = "Initial data disk size in GB"
  type        = number
  default     = 20
}

variable "disk_type" {
  description = "Cloud SQL disk type"
  type        = string
  default     = "PD_SSD"
}

variable "backup_start_time" {
  description = "UTC start time for automated backups (HH:MM)"
  type        = string
  default     = "03:00"
}

variable "point_in_time_recovery_enabled" {
  description = "Enable PostgreSQL point-in-time recovery"
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "Prevent accidental instance deletion"
  type        = bool
  default     = true
}
