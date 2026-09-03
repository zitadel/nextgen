project_id  = "REPLACE_GCP_PROJECT"
region      = "us-central1"
environment = "prod"

base_domain   = "zitadel.example.com"
dns_zone_name = "zitadel-prod"
cdn_enabled   = true

postgres_instance_name                  = "zitadel-prod"
postgres_database_name                  = "zitadel"
postgres_database_version               = "POSTGRES_17"
postgres_tier                           = "db-f1-micro"
postgres_edition                        = "ENTERPRISE"
postgres_availability_type              = "REGIONAL"
postgres_disk_size_gb                   = 20
postgres_point_in_time_recovery_enabled = true

cloud_run_cpu           = "2"
cloud_run_memory        = "1Gi"
cloud_run_min_instances = 1
cloud_run_max_instances = 20

github_deploy_sa_email = "github-deploy@zitadel-ops.iam.gserviceaccount.com"
