output "secret_ids" {
  description = "Map of secret short name to full resource ID"
  value = {
    for name in local.secret_names :
    name => google_secret_manager_secret.secrets[name].secret_id
  }
}
