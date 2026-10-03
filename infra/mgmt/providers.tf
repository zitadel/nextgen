terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Remote state in GCS. Initialise with:
  #   tofu init -backend-config=mgmt.tfbackend
  backend "gcs" {}
}

provider "google" {
  project = var.mgmt_project_id
  region  = var.region
}
