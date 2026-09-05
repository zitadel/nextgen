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
                              ├── Secret Manager (containers only)
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
| `secrets`         | Secret Manager containers + access bindings     |

## Resource ownership

| Resource                            | Owner                          | Lifecycle         |
| ----------------------------------- | ------------------------------ | ----------------- |
| AR, CI SAs, WIF                     | `infra/mgmt/` (OpenTofu)       | Rare changes      |
| GCS state bucket                    | `infra/bootstrap.sh` (manual)  | One-time          |
| LB, CDN, IAM, DNS                   | `infra/` (OpenTofu, per env)   | Infra changes     |
| Cloud SQL instance + database       | `infra/` (OpenTofu, per env)   | Infra changes     |
| Cloud Run image, command, env, probes | GitHub Actions deploy workflow | App releases    |
| Secret containers + access bindings | `infra/` (OpenTofu, per env)   | Infra changes     |
| Runtime secret *values*             | GitHub environment secrets     | Secret rotations  |
| Customer certs + host rules         | Not yet implemented            | Tenant onboarding |

## Getting started

### 1. Bootstrap (one-time)

```bash
# Create the GCS state bucket in the management project.
# bootstrap.sh lives in this directory, so run it from infra/.
cd infra
PROJECT_ID=zitadel-ops ./bootstrap.sh
```

### 2. Apply management config (one-time, locally)

```bash
cd infra/mgmt
# Edit mgmt.tfvars with your project IDs and GitHub repo
tofu init -backend-config=mgmt.tfbackend
tofu apply -var-file=mgmt.tfvars
```

### 3. Set the GitHub variables

Repository variables (Settings → Secrets and variables → Actions → Variables):

| Variable                    | Value                          | Used by                        |
| --------------------------- | ------------------------------ | ------------------------------ |
| `GCP_INFRA_WIF_PROVIDER`    | `tofu output wif_provider`     | `infra.yml` — plan and apply   |
| `GCP_INFRA_SERVICE_ACCOUNT` | `tofu output infra_apply_sa_email` | `infra.yml` — plan and apply |
| `GCP_WIF_PROVIDER`          | `tofu output wif_provider`     | `deploy.yml`                   |
| `GCP_WIF_SERVICE_ACCOUNT`   | `tofu output github_deploy_sa_email` | `deploy.yml`             |

Environment variables, on the `dev` environment rather than the repository, so
each environment names its own target:

| Variable         | Value                | Used by      |
| ---------------- | -------------------- | ------------ |
| `GCP_PROJECT_ID` | `zitadel-dev-492704` | `deploy.yml` |
| `GCP_REGION`     | `us-central1`        | `deploy.yml` |

The `dev` environment also carries the two secrets listed under
[Secrets](#secrets) below.

### 4. Apply environment (locally or via CI)

```bash
cd infra
tofu init -backend-config=environments/dev.tfbackend
tofu apply -var-file=environments/dev.tfvars
```

### CI (GitHub Actions)

PRs touching `infra/` (excluding `infra/mgmt/`) get an automatic plan comment.
Merging to `main` auto-applies the dev environment.

See `.github/workflows/infra.yml`.

## Secrets

OpenTofu owns the Secret Manager **containers** and the **access bindings**; it
never owns the **values**. A secret with no versions carries no credential
material, so nothing sensitive reaches OpenTofu state, while who may read each
secret stays reviewable in code.

The values live in the GitHub `dev` environment's secrets and are pushed to
Secret Manager as new versions by `.github/workflows/deploy.yml`. GitHub is the
source of truth; Secret Manager is the delivery mechanism Cloud Run requires.
Nothing secret is committed to this repository.

| GitHub environment secret | Secret Manager ID                        | Reaches the container as                              |
| ------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `MASTER_KEY_PEM`          | `zitadel-master-key-<environment>`       | a file in the server's master-key directory            |
| `DATABASE_POSTGRES_DSN`   | `zitadel-database-postgres-<environment>` | the `NEXTGEN_DATABASE_POSTGRES` env var               |

### Why the master key is a mounted file, not an env var

`server.master_keys` is a map keyed by key ID, and Viper cannot populate map
keys from environment variables — `NEXTGEN_SERVER_MASTER_KEYS_*` is silently
ignored. When no key is configured the server generates one into
`$NEXTGEN_SERVER_DATA_DIR/master-keys` and logs that it is "for local/dev
only". On Cloud Run that directory is ephemeral, so every instance would mint a
different key and KEKs wrapped by an earlier one would become undecryptable.

Mounting the PEM into that directory sidesteps both problems: the server
discovers keys in the master-key directory by filename, so a mounted key is
picked up with no config file and no secret in YAML.

The `NEXTGEN_DATABASE_POSTGRES` DSN uses the `postgres_private_ip` and
`postgres_database_name` outputs as inputs.

## First deploy

The runtime secrets are staged, because a Cloud Run revision cannot start
against a secret that has no versions and OpenTofu creates the containers
empty. Order matters exactly once, when an environment is new:

1. **Apply the environment** with `runtime_secrets_ready = false` (the shipped
   default). This creates the empty secret containers and their IAM bindings and
   leaves the service alone.
2. **Seed the secrets**: run the *Deploy / Cloud Run* workflow with
   `sync_secrets: true`. It pushes the environment's GitHub secrets into the
   containers as their first versions.
3. **Flip `runtime_secrets_ready` to true** in that environment's tfvars. The
   plan on that one-line change shows the master-key volume and the
   `NEXTGEN_DATABASE_POSTGRES` reference being added — which is the thing worth
   reviewing before it applies.

After that the flag stays true and deploys are just the workflow.

## Migrations

`zitadel-migrate-<environment>` exists but is **not wired**. The released binary
has no `migrate` subcommand — its only command is `server`, which runs
`pool.Migrate(ctx)` at startup. Running the job today would start a server that
never exits and fail on the job timeout, so the deploy workflow lets the service
migrate on start. Wire the job once a `migrate` command exists.
