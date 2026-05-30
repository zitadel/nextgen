# Zitadel GCP Infrastructure

Two-tier OpenTofu layout: a **management project** for shared resources and **environment projects** for workloads.

## Architecture

```
zitadel-ops (mgmt)            zitadel-dev / prod / ...
├── GCS state bucket          ├── Spanner
├── Artifact Registry         ├── Cloud Run (service + migrate job)
├── infra-apply SA + WIF      ├── External ALB + CDN
├── github-deploy SA + WIF    ├── Certificate Map
└── cross-project IAM         ├── Cloud DNS
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

| Module | Purpose |
|--------|---------|
| `project` | Enable required GCP APIs |
| `spanner` | Spanner instance + database shell |
| `iam` | Runtime + migrator SAs, deploy SA impersonation |
| `cloud-run` | Service (runtime) + Job (migrations) |
| `load-balancer` | External ALB + CDN + serverless NEG |
| `certificate-map` | Certificate Manager map (runtime-populated) |
| `dns` | Cloud DNS zone + A records |

## Resource ownership

| Resource | Owner | Lifecycle |
|----------|-------|-----------|
| AR, state bucket, CI SAs, WIF | `infra/mgmt/` (OpenTofu) | Rare changes |
| Spanner, LB, CDN, IAM, DNS | `infra/` (OpenTofu, per env) | Infra changes |
| Cloud Run image + secret env vars | GitHub Actions deploy workflow | App releases |
| Customer certs + host rules | Zitadel runtime (`infra.rs`) | Tenant onboarding |

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

Secrets flow from 1Password at deploy time, not through OpenTofu.
