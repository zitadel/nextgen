variable "region" {
  type = string
}

variable "environment" {
  type = string
}

variable "run_sa_email" {
  type = string
}

variable "migrator_sa_email" {
  type = string
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "min_instances" {
  type    = number
  default = 0
}

variable "max_instances" {
  type    = number
  default = 10
}

variable "deletion_protection" {
  description = "Prevent accidental deletion of the Cloud Run service"
  type        = bool
  default     = true
}

variable "vpc_network_id" {
  description = "VPC network ID for Direct VPC Egress"
  type        = string
}

variable "vpc_subnet_id" {
  description = "Subnet ID for Direct VPC Egress"
  type        = string
}

variable "master_key_secret_id" {
  description = "Secret Manager ID of the server master key, mounted as a file into the master key directory"
  type        = string
}

variable "database_postgres_secret_id" {
  description = "Secret Manager ID of the Postgres connection string, exposed as NEXTGEN_DATABASE_POSTGRES"
  type        = string
}

variable "data_dir" {
  description = "Server data dir; the master key directory is resolved beneath it. Must match NEXTGEN_SERVER_DATA_DIR in the image."
  type        = string
  default     = "/var/lib/zitadel/nextgen-data"
}
