# ─────────────────────────────────────────────────────────────────────────────
# Runtime secret containers.
#
# OpenTofu owns the containers and the access bindings — never the values.
# A secret with no versions carries no credential material, so nothing
# sensitive reaches OpenTofu state, while who may read each secret stays
# reviewable in code.
#
# The values live in the GitHub `dev` environment's secrets and are pushed
# here as new versions by .github/workflows/deploy.yml. GitHub is the source
# of truth; Secret Manager is the delivery mechanism Cloud Run requires.
# ─────────────────────────────────────────────────────────────────────────────

locals {
  secrets = {
    # RSA private key wrapping every project KEK. Mounted as a file into the
    # server's master-key directory, where it is discovered by filename.
    master_key = "zitadel-master-key-${var.environment}"
    # libpq connection string for the Cloud SQL instance, read from
    # NEXTGEN_DATABASE_POSTGRES.
    database_postgres = "zitadel-database-postgres-${var.environment}"
  }
}

resource "google_secret_manager_secret" "runtime" {
  for_each = local.secrets

  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }
}

# The Cloud Run service reads both secrets at container start.
resource "google_secret_manager_secret_iam_member" "run_accessor" {
  for_each = google_secret_manager_secret.runtime

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.run_sa_email}"
}

# The deploy workflow syncs values from GitHub environment secrets. Version
# adder, not admin: CI can write a new version but cannot read one back,
# delete the secret, or change who has access.
resource "google_secret_manager_secret_iam_member" "deploy_version_adder" {
  for_each = google_secret_manager_secret.runtime

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${var.github_deploy_sa_email}"
}

# Deliberately absent: a binding for the migrator service account. The
# zitadel-migrate-<env> job has no work to do yet — the released binary has no
# `migrate` subcommand, so migrations run at server startup instead. Grant the
# migrator access when that command lands.
