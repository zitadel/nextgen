locals {
  master_key_dir = "${var.data_dir}/master-keys"
  # The file name doubles as the key ID the server reports, so it is stable on
  # purpose: changing it would look like a new key rather than the same one.
  master_key_file_name = "master-key.pem"
}

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

    # The master key is a mounted file, not an env var: server.master_keys is a
    # map keyed by key ID and Viper cannot fill map keys from the environment,
    # but the server does discover keys in its master key directory by file
    # name. OpenTofu owns the volume rather than the deploy workflow — a
    # `gcloud run services update --set-secrets` is declarative over volumes as
    # well as env, so a mount CI owned would be stripped by the next apply, and
    # the server would silently mint a throwaway key under the same ID.
    dynamic "volumes" {
      for_each = var.runtime_secrets_ready ? [1] : []
      content {
        name = "master-key"
        secret {
          secret = var.master_key_secret_id
          items {
            path    = local.master_key_file_name
            version = "latest"
          }
        }
      }
    }

    containers {
      # `image` is required to create the service, but the deploy workflow —
      # not OpenTofu — owns which release runs here, so it is listed under
      # ignore_changes below. That makes this placeholder a create-time
      # bootstrap value, read once when the service does not yet exist and
      # never again: the live service runs the released image and `tofu plan`
      # proposes no change to it. Same terms for command, args, env, secret
      # references and probes. See .github/workflows/deploy.yml.
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      dynamic "volume_mounts" {
        for_each = var.runtime_secrets_ready ? [1] : []
        content {
          name = "master-key"
          # Mount the directory the server scans, not the file: Cloud Run mounts
          # a secret volume as a directory, and the server picks keys up by file
          # name from here.
          mount_path = local.master_key_dir
        }
      }

      # `server` does not migrate: since #1152 that needs --migrate, and the
      # image's own CMD is ["--migrate"]. Setting args explicitly overrides
      # that CMD and states the contract in code — the job migrates, the
      # service serves — instead of inheriting it from whatever a console
      # deploy last left behind.
      args = ["server"]

      dynamic "env" {
        for_each = var.runtime_secrets_ready ? [1] : []
        content {
          name = "NEXTGEN_DATABASE_POSTGRES"
          value_source {
            secret_key_ref {
              secret  = var.database_postgres_secret_id
              version = "latest"
            }
          }
        }
      }

      # Gated with the mount on purpose: refusing to generate a key is only
      # safe once a key is actually mounted, or the service could not start at
      # all while runtime_secrets_ready is still false.
      dynamic "env" {
        for_each = var.runtime_secrets_ready ? [1] : []
        content {
          name  = "NEXTGEN_SERVER_GENERATE_MASTER_KEY"
          value = "false"
        }
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
      # The deploy workflow owns the release itself and nothing else: it runs
      # `gcloud run services update --image` and stops there. Configuration —
      # env, secrets, volumes — is OpenTofu's, so that an apply cannot undo a
      # deploy and a deploy cannot undo an apply.
      template[0].containers[0].image,
      template[0].containers[0].command,
      template[0].containers[0].startup_probe,
      template[0].containers[0].liveness_probe,
      # The live container is named `nextgen-1` from an earlier console deploy.
      # The name has no effect on a single-container service, and adopting it
      # would otherwise roll a revision purely to null the field.
      template[0].containers[0].name,
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

      # The job carries the same secrets as the service. The DSN is the point
      # of the job; the master key is here because `migrate` loads the same
      # configuration as `server`, and with generation disabled (#1151) a start
      # that finds no key fails — in loadConfig, which `migrate` calls too.
      #
      # `migrate` never uses the key: it runs goose and exits without building
      # a crypter. Mounting it is what keeps the job startable, not something
      # the migration needs, so it should come off if that ever stops being
      # true. See the follow-up issue in infra/README.md.
      dynamic "volumes" {
        for_each = var.runtime_secrets_ready ? [1] : []
        content {
          name = "master-key"
          secret {
            secret = var.master_key_secret_id
            items {
              path    = local.master_key_file_name
              version = "latest"
            }
          }
        }
      }

      containers {
        # Create-time bootstrap value, for the same reason as the service
        # above; `image` is ignored below, so what the job carries in practice
        # is whatever the deploy workflow last set — today an old zitadel image
        # left over from before this configuration existed.
        image = "us-docker.pkg.dev/cloudrun/container/hello-job"

        # Apply schema and exit. `nextgen migrate` arrived in #1152; before it,
        # this job could not be wired at all, because the only command was
        # `server` and it would never have exited.
        args = ["migrate"]

        dynamic "volume_mounts" {
          for_each = var.runtime_secrets_ready ? [1] : []
          content {
            name       = "master-key"
            mount_path = local.master_key_dir
          }
        }

        dynamic "env" {
          for_each = var.runtime_secrets_ready ? [1] : []
          content {
            name = "NEXTGEN_DATABASE_POSTGRES"
            value_source {
              secret_key_ref {
                secret  = var.database_postgres_secret_id
                version = "latest"
              }
            }
          }
        }

        dynamic "env" {
          for_each = var.runtime_secrets_ready ? [1] : []
          content {
            name  = "NEXTGEN_SERVER_GENERATE_MASTER_KEY"
            value = "false"
          }
        }

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
      # Same split as the service: the deploy workflow owns the release, this
      # module owns the configuration.
      template[0].template[0].containers[0].image,
      template[0].template[0].containers[0].command,
      # Same reasoning as the service above — gcloud stamps these fields
      # on every update; Terraform should not fight them.
      client,
      client_version,
    ]
  }
}
