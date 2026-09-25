output "enabled_apis" {
  description = "Set of enabled API service names"
  value       = [for s in google_project_service.apis : s.service]
}
