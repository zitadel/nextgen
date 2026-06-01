variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "server_encryption_key_version" {
  description = "Secret Manager version for NEXTGEN_SERVER_ENCRYPTION_KEY."
  type        = string
  default     = "latest"
}

variable "database_postgres_version" {
  description = "Secret Manager version for NEXTGEN_DATABASE_POSTGRES."
  type        = string
  default     = "latest"
}
