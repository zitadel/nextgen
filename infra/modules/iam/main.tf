# ─────────────────────────────────────────────────────────────────────────────
# Service Account: zitadel-run (Cloud Run service identity)
# ─────────────────────────────────────────────────────────────────────────────
resource "google_service_account" "run" {
  account_id   = "zitadel-run"
  display_name = "Zitadel Runtime"
  description  = "Cloud Run service identity for the Zitadel runtime"
}

# Spanner access (read/write, no DDL)
resource "google_spanner_database_iam_member" "run_spanner" {
  instance = var.spanner_instance_name
  database = var.spanner_database_name
  role     = "roles/spanner.databaseUser"
  member   = "serviceAccount:${google_service_account.run.email}"
}

# Logging
resource "google_project_iam_member" "run_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.run.email}"
}

# Tracing
resource "google_project_iam_member" "run_tracing" {
  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.run.email}"
}

# Metrics
resource "google_project_iam_member" "run_metrics" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.run.email}"
}

# Certificate Manager — runtime domain provisioning (infra.rs)
resource "google_project_iam_member" "run_cert_manager" {
  project = var.project_id
  role    = "roles/certificatemanager.editor"
  member  = "serviceAccount:${google_service_account.run.email}"
}

# Load Balancer — runtime host rule management (infra.rs)
resource "google_project_iam_member" "run_lb_admin" {
  project = var.project_id
  role    = "roles/compute.loadBalancerAdmin"
  member  = "serviceAccount:${google_service_account.run.email}"
}

# DNS — runtime DNS authorization records (infra.rs)
resource "google_project_iam_member" "run_dns" {
  project = var.project_id
  role    = "roles/dns.admin"
  member  = "serviceAccount:${google_service_account.run.email}"
}

# ─────────────────────────────────────────────────────────────────────────────
# Service Account: zitadel-migrator (Cloud Run Job for schema migrations)
# ─────────────────────────────────────────────────────────────────────────────
resource "google_service_account" "migrator" {
  account_id   = "zitadel-migrator"
  display_name = "Zitadel Migrator"
  description  = "Cloud Run Job identity for schema migrations"
}

# Spanner DDL access (migrate.rs uses admin API for DDL statements)
resource "google_spanner_database_iam_member" "migrator_spanner" {
  instance = var.spanner_instance_name
  database = var.spanner_database_name
  role     = "roles/spanner.databaseAdmin"
  member   = "serviceAccount:${google_service_account.migrator.email}"
}

# Logging for migration output
resource "google_project_iam_member" "migrator_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.migrator.email}"
}

# ─────────────────────────────────────────────────────────────────────────────
# Secret Manager: runtime + migrator SAs can read secrets at container start
# ─────────────────────────────────────────────────────────────────────────────
resource "google_secret_manager_secret_iam_member" "run_secret_access" {
  for_each  = var.secret_ids
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "migrator_secret_access" {
  for_each  = var.secret_ids
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.migrator.email}"
}

# Deploy SA can push new secret versions (1Password → Secret Manager sync)
resource "google_secret_manager_secret_iam_member" "deploy_secret_version" {
  for_each  = var.secret_ids
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretVersionManager"
  member    = "serviceAccount:${var.github_deploy_sa_email}"
}

# Deploy SA can read current secret values (idempotent sync comparison)
resource "google_secret_manager_secret_iam_member" "deploy_secret_access" {
  for_each  = var.secret_ids
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.github_deploy_sa_email}"
}

# ─────────────────────────────────────────────────────────────────────────────
# Cross-project: allow github-deploy SA (from mgmt) to impersonate local SAs
# ─────────────────────────────────────────────────────────────────────────────
resource "google_service_account_iam_member" "deploy_impersonate_run" {
  service_account_id = google_service_account.run.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.github_deploy_sa_email}"
}

resource "google_service_account_iam_member" "deploy_impersonate_migrator" {
  service_account_id = google_service_account.migrator.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.github_deploy_sa_email}"
}
