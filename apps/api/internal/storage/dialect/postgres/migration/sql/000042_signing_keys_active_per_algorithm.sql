-- +goose Up
-- A project holds one active token signing key per algorithm (ADR 082 §7):
-- EdDSA, minted with the project, and RS256 and ES256, minted the first time
-- a token needs them. The index from 000012 allowed one active token key per
-- project whatever its algorithm; this one allows one per project and
-- algorithm, and backs the active-key lookup by algorithm.
--
-- signing_keys is a few rows per project, written only when a key is minted,
-- so a plain build in the migration's transaction is brief, and the new index
-- and the drop of the old one land together.
CREATE UNIQUE INDEX uq_token_signing_keys_active_per_project_algorithm
    ON zitadel_nextgen.signing_keys (project_id, algorithm) WHERE state = 'active' AND purpose = 'token';
DROP INDEX IF EXISTS zitadel_nextgen.uq_token_signing_keys_active_per_project;

-- +goose Down
-- Fails while a project holds active token keys of more than one algorithm:
-- retire all but one of them first.
CREATE UNIQUE INDEX uq_token_signing_keys_active_per_project
    ON zitadel_nextgen.signing_keys (project_id) WHERE state = 'active' AND purpose = 'token';
DROP INDEX IF EXISTS zitadel_nextgen.uq_token_signing_keys_active_per_project_algorithm;
