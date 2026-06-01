# Zitadel GCP Infrastructure

Two-tier OpenTofu layout: a **management project** for shared resources and **environment projects** for workloads.

## Architecture

```
zitadel-ops (mgmt)            zitadel-dev / prod / ...
├── GCS state bucket          ├── Cloud Run (service + migrate job)
├── Artifact Registry         ├── External ALB + CDN
├── infra-apply SA + WIF      ├── Certificate Map
├── github-deploy SA + WIF    ├── Cloud DNS
└── cross-project IAM         ├── Cloud SQL for PostgreSQL
                              └── IAM (runtime + migrator SAs)
```

## Directory layout

```
infra/
  mgmt/           Shared resources — run once locally
  modules/        Reusable modules for environment config
  environments/   Per-environment tfvars (dev.tfvars, prod.tfvars)
  main.tf         Environment root module
  bootstrap.sh    Creates the GCS state bucket (one-time)
```

## Modules (environment)

| Module            | Purpose                                         |
| ----------------- | ----------------------------------------------- |
| `project`         | Enable required GCP APIs                        |
| `iam`             | Runtime + migrator SAs, deploy SA impersonation |
| `cloud-run`       | Service (runtime) + Job (migrations)            |
| `load-balancer`   | External ALB + CDN + serverless NEG             |
| `certificate-map` | Certificate Manager map (runtime-populated)     |
| `dns`             | Cloud DNS zone + A records                      |
| `postgres`        | Cloud SQL PostgreSQL instance + database        |

## Resource ownership

| Resource                            | Owner                          | Lifecycle         |
| ----------------------------------- | ------------------------------ | ----------------- |
| AR, state bucket, CI SAs, WIF       | `infra/mgmt/` (OpenTofu)       | Rare changes      |
| LB, CDN, IAM, DNS                   | `infra/` (OpenTofu, per env)   | Infra changes     |
| Cloud SQL instance + database       | `infra/` (OpenTofu, per env)   | Infra changes     |
| Cloud Run image, command, env, probes | GitHub Actions deploy workflow | App releases    |
| Runtime secrets + secret access     | Manual Secret Manager ops      | Secret rotations  |
| Customer certs + host rules         | Zitadel runtime (`infra.rs`)   | Tenant onboarding |

## Getting started

### 1. Bootstrap (one-time)

```bash
# Create the GCS state bucket in the management project
export PROJECT_ID=zitadel-ops
./bootstrap.sh
```

### 2. Apply management config (one-time, locally)

```bash
cd infra/mgmt
# Edit mgmt.tfvars with your project IDs and GitHub repo
tofu init -backend-config="bucket=zitadel-ops-tofu-state" -backend-config="prefix=mgmt"
tofu apply -var-file=mgmt.tfvars
```

Set GitHub repository variables from the outputs (see bootstrap.sh for the full list).

### 3. Apply environment (locally or via CI)

```bash
cd infra
tofu init -backend-config="bucket=zitadel-ops-tofu-state" -backend-config="prefix=infra/dev"
tofu apply -var-file=environments/dev.tfvars
```

### CI (GitHub Actions)

PRs touching `infra/` (excluding `infra/mgmt/`) get an automatic plan comment.
Merging to `main` auto-applies the dev environment.

See `.github/workflows/infra.yml`.

## Secrets

OpenTofu does not manage Secret Manager containers, secret values, secret IAM
bindings, or Cloud Run secret references. Runtime secrets are created, rotated,
granted, and attached outside OpenTofu so credentials never enter OpenTofu
state.

OpenTofu creates the Cloud SQL PostgreSQL instance and empty database. The
manually managed `NEXTGEN_DATABASE_POSTGRES` connection string uses the
`postgres_private_ip` and `postgres_database_name` outputs as DSN inputs.

The runtime secret values are:

| Cloud Run env var                 | Secret Manager ID                                  |
| --------------------------------- | -------------------------------------------------- |
| `NEXTGEN_SERVER_ENCRYPTION_KEY`   | `zitadel-encryption-key-secret-<environment>`      |
| `NEXTGEN_DATABASE_POSTGRES`       | `zitadel-database-postgres-secret-<environment>`   |
