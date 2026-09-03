variable "environment" {
  type = string
}

variable "region" {
  type = string
}

variable "subnet_cidr" {
  description = "CIDR range for the Cloud Run subnet"
  type        = string
  default     = "10.0.0.0/24"
}
