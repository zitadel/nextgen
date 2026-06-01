resource "google_cloud_run_v2_service" "zitadel" {
  name                = "zitadel-${var.environment}"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  deletion_protection = var.deletion_protection

  scaling {
    min_instance_count = var.min_instances
  }

  template {
    service_account = var.run_sa_email

    vpc_access {
      network_interfaces {
        network    = var.vpc_network_id
        subnetwork = var.vpc_subnet_id
      }
      egress = "ALL_TRAFFIC"
    }

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      # Placeholder — the deploy workflow replaces image, command, args,
      # env, secret references, and probes via gcloud/manual release
      # operations.
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      # Deploy workflow owns release-specific fields via `gcloud run services update`.
      template[0].containers[0].image,
      template[0].containers[0].command,
      template[0].containers[0].args,
      template[0].containers[0].env,
      template[0].containers[0].startup_probe,
      template[0].containers[0].liveness_probe,
      # gcloud stamps these metadata fields on every update; Terraform should
      # leave them alone so drift-clearing applies don't trigger a new
      # revision (and the cross-project image validation that comes with it).
      client,
      client_version,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "allow_lb" {
  name     = google_cloud_run_v2_service.zitadel.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_job" "migrate" {
  name     = "zitadel-migrate-${var.environment}"
  location = var.region

  template {
    task_count = 1

    template {
      service_account = var.migrator_sa_email
      max_retries     = 0
      timeout         = "600s"

      vpc_access {
        network_interfaces {
          network    = var.vpc_network_id
          subnetwork = var.vpc_subnet_id
        }
        egress = "ALL_TRAFFIC"
      }

      containers {
        image = "us-docker.pkg.dev/cloudrun/container/hello-job"

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      # Deploy workflow owns release-specific fields via `gcloud run jobs update`.
      template[0].template[0].containers[0].image,
      template[0].template[0].containers[0].command,
      template[0].template[0].containers[0].args,
      template[0].template[0].containers[0].env,
      # Same reasoning as the service above — gcloud stamps these fields
      # on every update; Terraform should not fight them.
      client,
      client_version,
    ]
  }
}
