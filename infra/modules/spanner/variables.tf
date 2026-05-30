variable "instance_name" {
  description = "Spanner instance name"
  type        = string
}

variable "database_name" {
  description = "Spanner database name"
  type        = string
  default     = "zitadel"
}

variable "spanner_config" {
  description = "Spanner instance configuration (e.g. regional-us-central1, nam7)"
  type        = string
}

variable "processing_units" {
  description = "Processing units (100 = minimum, 1000 = 1 node)"
  type        = number
  default     = 100
}

variable "environment" {
  description = "Environment label"
  type        = string
}

variable "deletion_protection" {
  description = "Prevent accidental database deletion"
  type        = bool
  default     = false
}
