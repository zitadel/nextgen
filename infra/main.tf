# ─────────────────────────────────────────────────────────────────────────────
# Zitadel Environment Infrastructure
#
# Per-environment workload resources. Shared resources (AR, CI identity, state)
# live in infra/mgmt/.
# Usage: tofu apply -var-file=environments/dev.tfvars
# ─────────────────────────────────────────────────────────────────────────────

module "project" {
  source     = "./modules/project"
  project_id = var.project_id
}

module "iam" {
  source = "./modules/iam"

  project_id             = var.project_id
  github_deploy_sa_email = var.github_deploy_sa_email

  depends_on = [module.project]
}

module "network" {
  source = "./modules/network"

  environment = var.environment
  region      = var.region

  depends_on = [module.project]
}

module "postgres" {
  source = "./modules/postgres"

  instance_name                  = var.postgres_instance_name
  database_name                  = var.postgres_database_name
  database_version               = var.postgres_database_version
  tier                           = var.postgres_tier
  edition                        = var.postgres_edition
  region                         = var.region
  environment                    = var.environment
  network_id                     = module.network.network_id
  availability_type              = var.postgres_availability_type
  disk_size_gb                   = var.postgres_disk_size_gb
  disk_type                      = var.postgres_disk_type
  backup_start_time              = var.postgres_backup_start_time
  point_in_time_recovery_enabled = var.postgres_point_in_time_recovery_enabled
  deletion_protection            = var.deletion_protection

  depends_on = [module.project]
}

module "secrets" {
  source = "./modules/secrets"

  project_id             = var.project_id
  environment            = var.environment
  run_sa_email           = module.iam.run_sa_email
  github_deploy_sa_email = var.github_deploy_sa_email

  depends_on = [module.project]
}

module "certificate_map" {
  source      = "./modules/certificate-map"
  environment = var.environment
  base_domain = var.base_domain

  depends_on = [module.project]
}

module "cloud_run" {
  source = "./modules/cloud-run"

  region              = var.region
  environment         = var.environment
  run_sa_email        = module.iam.run_sa_email
  migrator_sa_email   = module.iam.migrator_sa_email
  cpu                 = var.cloud_run_cpu
  memory              = var.cloud_run_memory
  min_instances       = var.cloud_run_min_instances
  max_instances       = var.cloud_run_max_instances
  deletion_protection = var.deletion_protection
  vpc_network_id      = module.network.network_id
  vpc_subnet_id       = module.network.subnet_id

  depends_on = [module.project]
}

module "load_balancer" {
  source = "./modules/load-balancer"

  region                 = var.region
  environment            = var.environment
  cloud_run_service_name = module.cloud_run.service_name
  certificate_map_id     = module.certificate_map.map_id
  cdn_enabled            = var.cdn_enabled
}

module "dns" {
  source = "./modules/dns"

  zone_name              = var.dns_zone_name
  base_domain            = var.base_domain
  environment            = var.environment
  lb_ipv4_address        = module.load_balancer.ipv4_address
  lb_ipv6_address        = module.load_balancer.ipv6_address
  cert_challenge_records = module.certificate_map.dns_challenge_records
}
