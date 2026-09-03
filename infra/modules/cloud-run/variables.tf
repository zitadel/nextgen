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
