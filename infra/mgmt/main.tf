# ─────────────────────────────────────────────────────────────────────────────
# Zitadel Management Project — shared CI/CD and registry resources
#
# Run once locally: tofu apply -var-file=mgmt.tfvars
# ─────────────────────────────────────────────────────────────────────────────

# ─── APIs ────────────────────────────────────────────────────────────────────

resource "google_project_service" "apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ])

  project            = var.mgmt_project_id
  service            = each.value
  disable_on_destroy = false
}

# ─── Artifact Registry ──────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "zitadel" {
  location      = var.region
  repository_id = "zitadel"
  format        = "DOCKER"
  description   = "Zitadel container images"

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 25
    }
  }

  depends_on = [google_project_service.apis]
}

# ─── Service Account: infra-apply (OpenTofu CI) ─────────────────────────────

resource "google_service_account" "infra_apply" {
  account_id   = "infra-apply"
  display_name = "OpenTofu CI"
  description  = "GitHub Actions identity for infrastructure plan/apply"

  depends_on = [google_project_service.apis]
}

# Mgmt project: read/write state bucket
resource "google_project_iam_member" "infra_apply_storage" {
  project = var.mgmt_project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${google_service_account.infra_apply.email}"
}

# Env projects: manage infrastructure
resource "google_project_iam_member" "infra_apply_editor" {
  for_each = var.env_project_ids
  project  = each.value
  role     = "roles/editor"
  member   = "serviceAccount:${google_service_account.infra_apply.email}"
}

resource "google_project_iam_member" "infra_apply_iam" {
  for_each = var.env_project_ids
  project  = each.value
  role     = "roles/iam.securityAdmin"
  member   = "serviceAccount:${google_service_account.infra_apply.email}"
}

# Mgmt project: read Artifact Registry. Terraform needs this to update
# Cloud Run services in env projects whose image lives in the mgmt AR repo —
# Cloud Run validates cross-project image pull permission for the caller on
# every service update, not just on creation.
resource "google_project_iam_member" "infra_apply_ar_reader" {
  project = var.mgmt_project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.infra_apply.email}"
}

# ─── Service Account: github-deploy (app deploy CI) ──────────────────────────

resource "google_service_account" "github_deploy" {
  account_id   = "github-deploy"
  display_name = "GitHub Actions Deploy"
  description  = "CI/CD identity for building and deploying from GitHub Actions"

  depends_on = [google_project_service.apis]
}

# Mgmt project: push images to Artifact Registry
resource "google_project_iam_member" "deploy_ar_writer" {
  project = var.mgmt_project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_deploy.email}"
}

# Env projects: deploy Cloud Run services and execute jobs
resource "google_project_iam_member" "deploy_run_developer" {
  for_each = var.env_project_ids
  project  = each.value
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.github_deploy.email}"
}

# ─── Cross-project image pull for Cloud Run ──────────────────────────────────
# Each env's Cloud Run Service Agent needs read access to the mgmt project's
# Artifact Registry repo to pull images at deploy time. The Service Agent's
# email uses the project NUMBER, so look it up per env project.

data "google_project" "env" {
  for_each   = var.env_project_ids
  project_id = each.value
}

resource "google_artifact_registry_repository_iam_member" "env_run_agent_reader" {
  for_each   = var.env_project_ids
  project    = var.mgmt_project_id
  location   = google_artifact_registry_repository.zitadel.location
  repository = google_artifact_registry_repository.zitadel.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-${data.google_project.env[each.key].number}@serverless-robot-prod.iam.gserviceaccount.com"
}

# ─── Workload Identity Federation ────────────────────────────────────────────

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "WIF pool for GitHub Actions CI/CD"

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  attribute_condition = "assertion.repository == '${var.github_repo}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Bind infra-apply SA to the WIF pool
resource "google_service_account_iam_member" "wif_infra_apply" {
  service_account_id = google_service_account.infra_apply.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

# Bind github-deploy SA to the WIF pool
resource "google_service_account_iam_member" "wif_github_deploy" {
  service_account_id = google_service_account.github_deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
