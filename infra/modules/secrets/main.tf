# ─────────────────────────────────────────────────────────────────────────────
# Secret Manager secrets for Zitadel runtime configuration.
#
# These are empty shells — actual values are written by the deploy workflow
# (1Password → Secret Manager) on every deploy.
# ─────────────────────────────────────────────────────────────────────────────

locals {
  # The runtime reads the active encryption key id from the literal env var
  # `ZITADEL_ENCRYPTION__ACTIVE_KEY_ID=k0` set by the deploy workflow, so we
  # do not provision a shell for it here — the key id is a non-secret label,
  # not a secret.
  secret_names = [
    "zitadel-cookie-secrets",
    "zitadel-encryption-key-secret",
    "zitadel-bootstrap-admin-password",
    "zitadel-management-secret",
  ]
}

resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.secret_names)
  secret_id = "${each.value}-${var.environment}"
  project   = var.project_id

  replication {
    auto {}
  }
}
