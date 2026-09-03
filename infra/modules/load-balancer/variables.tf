variable "region" {
  type = string
}

variable "environment" {
  type = string
}

variable "cloud_run_service_name" {
  type = string
}

variable "certificate_map_id" {
  type = string
}

variable "cdn_enabled" {
  type    = bool
  default = false
}
