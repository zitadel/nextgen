variable "zone_name" {
  type = string
}

variable "base_domain" {
  type = string
}

variable "environment" {
  type = string
}

variable "lb_ipv4_address" {
  type = string
}

variable "lb_ipv6_address" {
  type = string
}

variable "cert_challenge_records" {
  description = "DNS challenge records for Certificate Manager managed certs, keyed by a stable caller-chosen name so for_each works at plan time. Values may be computed."
  type = map(object({
    name = string
    type = string
    data = string
  }))
  default = {}
}
