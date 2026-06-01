project_id  = "zitadel-dev-492704"
region      = "us-central1"
environment = "dev"

base_domain         = "dev.zitadel.io"
dns_zone_name       = "zitadel-dev"
cdn_enabled         = false
deletion_protection = false

cloud_run_cpu           = "1"
cloud_run_memory        = "512Mi"
cloud_run_min_instances = 0
cloud_run_max_instances = 5

github_deploy_sa_email = "github-deploy@zitadel-ops.iam.gserviceaccount.com"
