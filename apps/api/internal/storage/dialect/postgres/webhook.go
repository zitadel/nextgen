package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/webhook"
)

const (
	webhookQuery = `SELECT ` + webhook.Columns + ` FROM zitadel_nextgen.webhooks`

	// FOR NO KEY UPDATE holds the project row until the transaction ends, so
	// a second create in the project waits here and then counts the first
	// one's webhook: at READ COMMITTED the count alone would not see it. It
	// does not block the key-share lock an insert of any child row takes.
	lockWebhookProjectStmt = `SELECT id FROM zitadel_nextgen.projects WHERE id = $1 FOR NO KEY UPDATE`

	// The insert writes nothing once the project holds $7 webhooks. The
	// cursor is stamped with clock_timestamp(), the clock that stamps
	// events.created_at (insertEventStmt): every event stored from here on
	// sorts after it, and none stored before does.
	createWebhookStmt = `
INSERT INTO zitadel_nextgen.webhooks
    (project_id, id, url, description, event_types, enabled, secret, cursor_created_at, cursor_event_id)
SELECT $1, $2, $3, $4, $5::text[], TRUE, $6, clock_timestamp(), ''
WHERE (SELECT count(*) FROM zitadel_nextgen.webhooks WHERE project_id = $1) < $7::int
RETURNING created_at`

	// The right-hand sides read the row as it was, so "NOT enabled" is the
	// state before this update: enabling a disabled webhook moves its cursor
	// to now, stamped as createWebhookStmt stamps it, and nothing else does.
	updateWebhookStmt = `
UPDATE zitadel_nextgen.webhooks SET
    url = COALESCE($3, url),
    description = COALESCE($4, description),
    event_types = COALESCE($5::text[], event_types),
    enabled = COALESCE($6::boolean, enabled),
    cursor_created_at = CASE WHEN $6::boolean AND NOT enabled THEN clock_timestamp() ELSE cursor_created_at END,
    cursor_event_id = CASE WHEN $6::boolean AND NOT enabled THEN '' ELSE cursor_event_id END,
    next_attempt_at = CASE WHEN $6::boolean AND NOT enabled THEN NULL ELSE next_attempt_at END,
    failing_since = CASE WHEN $6::boolean AND NOT enabled THEN NULL ELSE failing_since END,
    lease_holder = CASE WHEN $6::boolean AND NOT enabled THEN NULL ELSE lease_holder END,
    lease_expires_at = CASE WHEN $6::boolean AND NOT enabled THEN NULL ELSE lease_expires_at END
WHERE project_id = $1 AND id = $2
RETURNING ` + webhook.Columns

	deleteWebhookStmt = `DELETE FROM zitadel_nextgen.webhooks WHERE project_id = $1 AND id = $2`

	// The right-hand sides read the row as it was, so the stored secret
	// becomes the previous one in the same statement.
	rotateWebhookSecretStmt = `
UPDATE zitadel_nextgen.webhooks SET
    previous_secret = secret,
    secret = $3,
    previous_secret_expires_at = $4
WHERE project_id = $1 AND id = $2
RETURNING ` + webhook.Columns

	// SKIP LOCKED passes over a row another server is leasing in a statement
	// that has not committed yet. One that committed is seen: a row lock at
	// READ COMMITTED re-checks the conditions against the row as it is now,
	// which holds the other server's lease. The CTE is materialized so the
	// limit is applied once.
	leaseDueWebhooksStmt = `
WITH due AS MATERIALIZED (
    SELECT project_id, id FROM zitadel_nextgen.webhooks
    WHERE enabled
      AND ($6 = '' OR project_id = $6)
      AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
      AND (lease_expires_at IS NULL OR lease_expires_at <= $3)
    ORDER BY next_attempt_at NULLS FIRST, project_id, id
    LIMIT $5
    FOR UPDATE SKIP LOCKED
)
UPDATE zitadel_nextgen.webhooks SET lease_holder = $1, lease_expires_at = $4
WHERE (project_id, id) IN (SELECT project_id, id FROM due)
RETURNING ` + webhook.Columns

	recordWebhookProgressStmt = `
UPDATE zitadel_nextgen.webhooks SET
    cursor_created_at = $4,
    cursor_event_id = $5,
    last_delivered_at = COALESCE($6::timestamptz, last_delivered_at),
    failing_since = CASE WHEN $6::timestamptz IS NULL THEN failing_since END
WHERE project_id = $1 AND id = $2 AND lease_holder = $3`

	recordWebhookFailureStmt = `
UPDATE zitadel_nextgen.webhooks SET
    last_error_at = $4,
    last_error_status = $5,
    next_attempt_at = $6,
    failing_since = COALESCE(failing_since, $4),
    lease_holder = NULL,
    lease_expires_at = NULL
WHERE project_id = $1 AND id = $2 AND lease_holder = $3`

	disableFailedWebhookStmt = `
UPDATE zitadel_nextgen.webhooks SET
    enabled = FALSE,
    last_error_at = $4,
    last_error_status = $5,
    failing_since = COALESCE(failing_since, $4),
    lease_holder = NULL,
    lease_expires_at = NULL
WHERE project_id = $1 AND id = $2 AND lease_holder = $3 AND enabled`

	releaseWebhookLeaseStmt = `
UPDATE zitadel_nextgen.webhooks SET
    next_attempt_at = $4,
    lease_holder = NULL,
    lease_expires_at = NULL
WHERE project_id = $1 AND id = $2 AND lease_holder = $3`
)

type webhookStatements struct{ statement }

func newWebhookStatements(client queryExecutor) webhookStatements {
	return webhookStatements{statement: statement{client: client}}
}

// CreateWebhook implements [service.WebhookStatements].
func (s webhookStatements) CreateWebhook(ctx context.Context, entity *domain.Webhook) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixWebhook); err != nil {
		return err
	}
	eventTypes := entity.EventTypes
	if eventTypes == nil {
		eventTypes = []string{}
	}
	var createdAt time.Time
	err := withTransaction(ctx, s.client, func(ctx context.Context, tx queryExecutor) error {
		if _, err := tx.Exec(ctx, lockWebhookProjectStmt, entity.ProjectID); err != nil {
			return wrapError(err)
		}
		err := tx.QueryRow(ctx, createWebhookStmt,
			entity.ProjectID,
			entity.ID,
			entity.URL,
			entity.Description,
			eventTypes,
			entity.Secret,
			domain.WebhookProjectLimit,
		).Scan(&createdAt)
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ErrWebhookLimitReached().WithParent(err)
		}
		return wrapError(err)
	})
	if err != nil {
		return err
	}
	entity.EventTypes = eventTypes
	entity.Enabled = true
	// pgx scans timestamptz in Local; reads normalize to UTC.
	entity.CreatedAt = createdAt.UTC()
	return nil
}

// GetWebhook implements [service.WebhookStatements].
func (s webhookStatements) GetWebhook(ctx context.Context, projectID, id string) (*domain.Webhook, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, webhookQuery, webhook.ByID(projectID, id), webhook.Schema); err != nil {
		return nil, err
	}
	return s.queryOne(ctx, s.client, compiler.String(), compiler.args...)
}

// ListWebhooks implements [service.WebhookStatements].
func (s webhookStatements) ListWebhooks(ctx context.Context, projectID string, page database.Page[domain.WebhookField]) (*database.ListResult[*domain.Webhook], error) {
	opts := webhook.ListOptions(projectID, page)
	items, nextCursor, err := pagination.Page(opts.Pagination, webhook.Schema, func(limit uint32) ([]*domain.Webhook, error) {
		var compiler statementCompiler
		if err := compileRead(&compiler, webhookQuery, opts.WithLimit(limit), webhook.Schema); err != nil {
			return nil, err
		}
		rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		items, err := pgx.CollectRows(rows, scanWebhook)
		if err != nil {
			return nil, wrapError(err)
		}
		return items, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.Webhook]{Items: items, NextCursor: nextCursor}, nil
}

// UpdateWebhook implements [service.WebhookStatements].
func (s webhookStatements) UpdateWebhook(ctx context.Context, projectID, id string, update domain.WebhookUpdate) (*domain.Webhook, error) {
	return s.queryOne(ctx, s.client, updateWebhookStmt,
		projectID, id, update.URL, update.Description, update.EventTypes, update.Enabled)
}

// DeleteWebhook implements [service.WebhookStatements].
func (s webhookStatements) DeleteWebhook(ctx context.Context, projectID, id string) error {
	tag, err := s.client.Exec(ctx, deleteWebhookStmt, projectID, id)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// RotateWebhookSecret implements [service.WebhookStatements].
func (s webhookStatements) RotateWebhookSecret(ctx context.Context, projectID, id, secret string, previousExpiresAt time.Time) (*domain.Webhook, error) {
	return s.queryOne(ctx, s.client, rotateWebhookSecretStmt, projectID, id, secret, previousExpiresAt.UTC())
}

// LeaseDueWebhooks implements [service.WebhookStatements].
func (s webhookStatements) LeaseDueWebhooks(ctx context.Context, projectID, holder string, dueBy, now, leaseUntil time.Time, limit uint32) ([]*domain.Webhook, error) {
	rows, err := s.client.Query(ctx, leaseDueWebhooksStmt, holder, dueBy.UTC(), now.UTC(), leaseUntil.UTC(), limit, projectID)
	if err != nil {
		return nil, wrapError(err)
	}
	items, err := pgx.CollectRows(rows, scanWebhook)
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

// RecordWebhookProgress implements [service.WebhookStatements].
func (s webhookStatements) RecordWebhookProgress(ctx context.Context, projectID, id, holder string, cursorCreatedAt time.Time, cursorEventID string, deliveredAt *time.Time) error {
	return s.execLeased(ctx, recordWebhookProgressStmt, projectID, id, holder, cursorCreatedAt.UTC(), cursorEventID, deliveredAt)
}

// RecordWebhookFailure implements [service.WebhookStatements].
func (s webhookStatements) RecordWebhookFailure(ctx context.Context, projectID, id, holder string, at time.Time, status *int32, nextAttemptAt time.Time) error {
	return s.execLeased(ctx, recordWebhookFailureStmt, projectID, id, holder, at.UTC(), status, nextAttemptAt.UTC())
}

// DisableFailedWebhook implements [service.WebhookStatements].
func (s webhookStatements) DisableFailedWebhook(ctx context.Context, projectID, id, holder string, at time.Time, status *int32) error {
	return s.execLeased(ctx, disableFailedWebhookStmt, projectID, id, holder, at.UTC(), status)
}

// ReleaseWebhookLease implements [service.WebhookStatements].
func (s webhookStatements) ReleaseWebhookLease(ctx context.Context, projectID, id, holder string, nextAttemptAt time.Time) error {
	return s.execLeased(ctx, releaseWebhookLeaseStmt, projectID, id, holder, nextAttemptAt.UTC())
}

// execLeased runs a write on a webhook its holder has leased, or none when
// the holder no longer holds it: a *database.NoRowFoundError.
func (s webhookStatements) execLeased(ctx context.Context, stmt string, args ...any) error {
	tag, err := s.client.Exec(ctx, stmt, args...)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// queryOne runs a statement that returns one webhook, or none when the
// project has no webhook of that id: a *database.NoRowFoundError.
func (s webhookStatements) queryOne(ctx context.Context, client queryExecutor, stmt string, args ...any) (*domain.Webhook, error) {
	rows, err := client.Query(ctx, stmt, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanWebhook)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

func scanWebhook(row pgx.CollectableRow) (*domain.Webhook, error) {
	var entity domain.Webhook
	if err := row.Scan(
		&entity.ID,
		&entity.ProjectID,
		&entity.URL,
		&entity.Description,
		&entity.EventTypes,
		&entity.Enabled,
		&entity.Secret,
		&entity.PreviousSecret,
		&entity.PreviousSecretExpiresAt,
		&entity.LastDeliveredAt,
		&entity.LastErrorAt,
		&entity.LastErrorStatus,
		&entity.CursorCreatedAt,
		&entity.CursorEventID,
		&entity.CreatedAt,
		&entity.NextAttemptAt,
		&entity.FailingSince,
		&entity.LeaseHolder,
		&entity.LeaseExpiresAt,
	); err != nil {
		return nil, err
	}
	// pgx scans timestamptz in Local; reads normalize to UTC.
	entity.CreatedAt, entity.CursorCreatedAt = entity.CreatedAt.UTC(), entity.CursorCreatedAt.UTC()
	for _, at := range []*time.Time{
		entity.PreviousSecretExpiresAt, entity.LastDeliveredAt, entity.LastErrorAt,
		entity.NextAttemptAt, entity.FailingSince, entity.LeaseExpiresAt,
	} {
		if at != nil {
			*at = at.UTC()
		}
	}
	return &entity, nil
}

var _ service.WebhookStatements = (*webhookStatements)(nil)
