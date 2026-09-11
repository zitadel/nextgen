#!/usr/bin/env bash
# One-time bootstrap: create the GCS state bucket in the management project.
# Everything else is managed by OpenTofu (infra/mgmt/).
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID (management project, e.g. zitadel-ops)}"
REGION="${REGION:-us-central1}"
STATE_BUCKET="${STATE_BUCKET:-${PROJECT_ID}-tofu-state}"

echo "==> Creating state bucket gs://${STATE_BUCKET} in ${PROJECT_ID}..."
gcloud storage buckets create "gs://${STATE_BUCKET}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --uniform-bucket-level-access \
  2>/dev/null || echo "    (bucket already exists)"

cat <<NEXT

==> State bucket ready.

==> Next steps:

1. Fill in infra/mgmt/mgmt.tfvars with your project IDs and repo.

2. Apply the management config locally:

   cd infra/mgmt
   tofu init -backend-config=mgmt.tfbackend
   tofu apply -var-file=mgmt.tfvars

3. Note the outputs and set the GitHub repository variables:

   GCP_INFRA_WIF_PROVIDER:    (from tofu output wif_provider)
   GCP_INFRA_SERVICE_ACCOUNT: (from tofu output infra_apply_sa_email)
   GCP_WIF_PROVIDER:          (from tofu output wif_provider)
   GCP_WIF_SERVICE_ACCOUNT:   (from tofu output github_deploy_sa_email)

   And, on each environment rather than the repository:

   GCP_PROJECT_ID:            (that environment's project, e.g. zitadel-dev-492704)
   GCP_REGION:                ${REGION}

   See infra/README.md for what reads each one.

4. Apply the dev environment:

   cd infra
   tofu init -backend-config=environments/dev.tfbackend
   tofu apply -var-file=environments/dev.tfvars

NEXT
