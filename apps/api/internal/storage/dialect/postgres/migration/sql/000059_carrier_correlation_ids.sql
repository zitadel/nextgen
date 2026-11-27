-- +goose Up
-- The chain a carrier holds: the stored thing through which a later request
-- inherits its correlation_id (ADR 048, amendment of 2026-11-26). An
-- authorization request hands it to the flow created for it and to the
-- redemption of its code, an auth attempt to the provider's callback and the
-- handoff exchange, a claim challenge to its status polls and its
-- completion. An invitation holds its chain in journey_id already. NULL on a
-- row stored before chains: a request that reads it joins none.
--
-- A nullable column without a default changes only the catalog.
ALTER TABLE zitadel_nextgen.auth_requests
    ADD COLUMN IF NOT EXISTS correlation_id TEXT COLLATE "C";
ALTER TABLE zitadel_nextgen.auth_attempts
    ADD COLUMN IF NOT EXISTS correlation_id TEXT COLLATE "C";
ALTER TABLE zitadel_nextgen.claim_challenges
    ADD COLUMN IF NOT EXISTS correlation_id TEXT COLLATE "C";

-- +goose Down
ALTER TABLE zitadel_nextgen.claim_challenges
    DROP COLUMN IF EXISTS correlation_id;
ALTER TABLE zitadel_nextgen.auth_attempts
    DROP COLUMN IF EXISTS correlation_id;
ALTER TABLE zitadel_nextgen.auth_requests
    DROP COLUMN IF EXISTS correlation_id;
