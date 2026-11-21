package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/webhook"
)

const (
	webhookTable = "webhooks"

	webhookQuery = `SELECT ` + webhook.Columns + ` FROM webhooks`

	// Read inside the create's read-write transaction, the count locks the
	// project's range of idx_webhooks_project_created_at: of two creates that
	// both counted below the limit, the second to commit aborts on the first
	// one's insert and is replayed against the new count.
	countWebhooksStmt = `
SELECT COUNT(*) FROM webhooks@{FORCE_INDEX=idx_webhooks_project_created_at}
WHERE project_id = @p1`

	// cursor_created_at is a placeholder here: cursorAtNow replaces it when
	// the transaction commits.
	createWebhookStmt = `
INSERT INTO webhooks
    (project_id, id, url, description, event_types, enabled, secret, cursor_created_at, cursor_event_id)
VALUES (@p1, @p2, @p3, @p4, @p5, TRUE, @p6, CURRENT_TIMESTAMP(), '')
THEN RETURN created_at`

	// FOR UPDATE, so that two updates of one webhook do not both read it
	// disabled; see LockIDPConnection.
	webhookEnabledStmt = `SELECT enabled FROM webhooks WHERE project_id = @p1 AND id = @p2 FOR UPDATE`

	updateWebhookStmt = `
UPDATE webhooks SET
    url = COALESCE(@p3, url),
    description = COALESCE(@p4, description),
    event_types = COALESCE(@p5, event_types),
    enabled = COALESCE(@p6, enabled)
WHERE project_id = @p1 AND id = @p2
THEN RETURN ` + webhook.Columns

	deleteWebhookStmt = `DELETE FROM webhooks WHERE project_id = @p1 AND id = @p2`

	// The right-hand sides read the row as it was, so the stored secret
	// becomes the previous one in the same statement.
	rotateWebhookSecretStmt = `
UPDATE webhooks SET
    previous_secret = secret,
    secret = @p3,
    previous_secret_expires_at = @p4
WHERE project_id = @p1 AND id = @p2
THEN RETURN ` + webhook.Columns

	// Read inside the lease's read-write transaction, so of two servers that
	// both read a webhook as free, the second to commit aborts and is
	// replayed against the first one's lease. Spanner sorts NULL first: a
	// webhook that was never attempted comes before the longest due.
	dueWebhooksStmt = webhookQuery + `
WHERE enabled
  AND (@p4 = '' OR project_id = @p4)
  AND (next_attempt_at IS NULL OR next_attempt_at <= @p1)
  AND (lease_expires_at IS NULL OR lease_expires_at <= @p2)
ORDER BY next_attempt_at, project_id, id
LIMIT @p3`

	recordWebhookProgressStmt = `
UPDATE webhooks SET
    cursor_created_at = @p4,
    cursor_event_id = @p5,
    last_delivered_at = COALESCE(@p6, last_delivered_at),
    failing_since = IF(@p6 IS NULL, failing_since, NULL)
WHERE project_id = @p1 AND id = @p2 AND lease_holder = @p3`

	recordWebhookFailureStmt = `
UPDATE webhooks SET
    last_error_at = @p4,
    last_error_status = @p5,
    next_attempt_at = @p6,
    failing_since = COALESCE(failing_since, @p4),
    lease_holder = NULL,
    lease_expires_at = NULL
WHERE project_id = @p1 AND id = @p2 AND lease_holder = @p3`

	disableFailedWebhookStmt = `
UPDATE webhooks SET
    enabled = FALSE,
    last_error_at = @p4,
    last_error_status = @p5,
    failing_since = COALESCE(failing_since, @p4),
    lease_holder = NULL,
    lease_expires_at = NULL
WHERE project_id = @p1 AND id = @p2 AND lease_holder = @p3 AND enabled`

	releaseWebhookLeaseStmt = `
UPDATE webhooks SET
    next_attempt_at = @p4,
    lease_holder = NULL,
    lease_expires_at = NULL
WHERE project_id = @p1 AND id = @p2 AND lease_holder = @p3`
)

// webhookStartColumns are what a new webhook and one enabled anew start
// from: the cursor, and no delivery state.
var webhookStartColumns = []string{
	"project_id", "id", "cursor_created_at", "cursor_event_id",
	"next_attempt_at", "failing_since", "lease_holder", "lease_expires_at",
}

var webhookLeaseColumns = []string{"project_id", "id", "lease_holder", "lease_expires_at"}

type webhookStatements struct{ statement }

func newWebhookStatements(db queryExecutor) webhookStatements {
	return webhookStatements{statement: statement{db: db}}
}

// cursorAtNow moves the webhook's cursor to the commit timestamp of the
// transaction it is buffered in, the clock that stamps events.created_at
// (InsertEvent): an event that commits later sorts after it, and none that
// committed earlier does. An event of the same transaction shares the
// timestamp and sorts after the empty id, so it is delivered. It also clears
// the delivery state, so the webhook starts clean.
//
// It is a mutation, applied at commit after the transaction's DML, not
// PENDING_COMMIT_TIMESTAMP() in that DML: a table written with it cannot be
// read for the rest of its transaction, nor can THEN RETURN hand back the
// row.
func cursorAtNow(ctx context.Context, tx queryExecutor, projectID, id string) error {
	_, err := tx.BufferWrite(ctx, []*spanner.Mutation{
		spanner.Update(webhookTable, webhookStartColumns,
			[]any{projectID, id, spanner.CommitTimestamp, "", nil, nil, nil, nil}),
	})
	return err
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
	// A retry replays the callback, so the stamp stays local to an attempt.
	var createdAt time.Time
	err := withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		var count int64
		if err := tx.Query(ctx, buildStatement(countWebhooksStmt, entity.ProjectID).statement(), func(iter *spanner.RowIterator) error {
			var err error
			count, err = collectOneRow(iter, func(row *spanner.Row) (int64, error) {
				var n int64
				err := row.Columns(&n)
				return n, err
			})
			return err
		}); err != nil {
			return err
		}
		if count >= domain.WebhookProjectLimit {
			return domain.ErrWebhookLimitReached()
		}
		stmt := buildStatement(createWebhookStmt,
			entity.ProjectID,
			entity.ID,
			entity.URL,
			entity.Description,
			eventTypes,
			entity.Secret,
		).statement()
		if err := tx.Write(ctx, stmt, scanReturnedTimestamp(&createdAt)); err != nil {
			return err
		}
		return cursorAtNow(ctx, tx, entity.ProjectID, entity.ID)
	})
	if err != nil {
		return err
	}
	entity.EventTypes = eventTypes
	entity.Enabled = true
	entity.CreatedAt = createdAt
	return nil
}

// GetWebhook implements [service.WebhookStatements].
func (s webhookStatements) GetWebhook(ctx context.Context, projectID, id string) (*domain.Webhook, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, webhookQuery, webhook.ByID(projectID, id), webhook.Schema); err != nil {
		return nil, err
	}
	var entity *domain.Webhook
	if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanWebhook)
		return err
	}); err != nil {
		return nil, err
	}
	return entity, nil
}

// ListWebhooks implements [service.WebhookStatements].
func (s webhookStatements) ListWebhooks(ctx context.Context, projectID string, page database.Page[domain.WebhookField]) (*database.ListResult[*domain.Webhook], error) {
	opts := webhook.ListOptions(projectID, page)
	items, nextCursor, err := pagination.Page(opts.Pagination, webhook.Schema, func(limit uint32) ([]*domain.Webhook, error) {
		var compiler statementCompiler
		if err := compileRead(&compiler, webhookQuery, opts.WithLimit(limit), webhook.Schema); err != nil {
			return nil, err
		}
		var items []*domain.Webhook
		if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var err error
			items, err = collectRows(iter, scanWebhook)
			return err
		}); err != nil {
			return nil, err
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
	stmt := buildStatement(updateWebhookStmt,
		projectID, id, update.URL, update.Description, update.EventTypes, update.Enabled,
	).statement()
	if update.Enabled == nil || !*update.Enabled {
		return s.writeOne(ctx, s.db, stmt)
	}
	var entity *domain.Webhook
	err := withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		var wasEnabled bool
		if err := tx.Query(ctx, buildStatement(webhookEnabledStmt, projectID, id).statement(), func(iter *spanner.RowIterator) error {
			var err error
			wasEnabled, err = collectOneRow(iter, func(row *spanner.Row) (bool, error) {
				var enabled bool
				err := row.Columns(&enabled)
				return enabled, err
			})
			return err
		}); err != nil {
			return err
		}
		var err error
		if entity, err = s.writeOne(ctx, tx, stmt); err != nil {
			return err
		}
		if wasEnabled {
			return nil
		}
		// The commit decides the cursor, so the row just read back holds the
		// one it replaces, and the delivery state the same write clears.
		entity.CursorCreatedAt, entity.CursorEventID = time.Time{}, ""
		entity.NextAttemptAt, entity.FailingSince, entity.LeaseHolder, entity.LeaseExpiresAt = nil, nil, nil, nil
		return cursorAtNow(ctx, tx, projectID, id)
	})
	if err != nil {
		return nil, err
	}
	return entity, nil
}

// DeleteWebhook implements [service.WebhookStatements].
func (s webhookStatements) DeleteWebhook(ctx context.Context, projectID, id string) error {
	n, err := s.db.Update(ctx, buildStatement(deleteWebhookStmt, projectID, id).statement())
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

// RotateWebhookSecret implements [service.WebhookStatements].
func (s webhookStatements) RotateWebhookSecret(ctx context.Context, projectID, id, secret string, previousExpiresAt time.Time) (*domain.Webhook, error) {
	return s.writeOne(ctx, s.db, buildStatement(rotateWebhookSecretStmt, projectID, id, secret, previousExpiresAt.UTC()).statement())
}

// LeaseDueWebhooks implements [service.WebhookStatements].
func (s webhookStatements) LeaseDueWebhooks(ctx context.Context, projectID, holder string, dueBy, now, leaseUntil time.Time, limit uint32) ([]*domain.Webhook, error) {
	leaseUntil = leaseUntil.UTC()
	// A retry replays the callback, so the result stays local to an attempt.
	var leased []*domain.Webhook
	err := withTransaction(ctx, s.db, func(ctx context.Context, tx queryExecutor) error {
		var due []*domain.Webhook
		stmt := buildStatement(dueWebhooksStmt, dueBy.UTC(), now.UTC(), int64(limit), projectID).statement()
		if err := tx.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
			var err error
			due, err = collectRows(iter, scanWebhook)
			return err
		}); err != nil {
			return err
		}
		leased = due
		if len(due) == 0 {
			return nil
		}
		mutations := make([]*spanner.Mutation, len(due))
		for i, entity := range due {
			mutations[i] = spanner.Update(webhookTable, webhookLeaseColumns,
				[]any{entity.ProjectID, entity.ID, holder, leaseUntil})
			entity.LeaseHolder, entity.LeaseExpiresAt = &holder, &leaseUntil
		}
		_, err := tx.BufferWrite(ctx, mutations)
		return err
	})
	if err != nil {
		return nil, err
	}
	return leased, nil
}

// RecordWebhookProgress implements [service.WebhookStatements].
func (s webhookStatements) RecordWebhookProgress(ctx context.Context, projectID, id, holder string, cursorCreatedAt time.Time, cursorEventID string, deliveredAt *time.Time) error {
	delivered := spanner.NullTime{}
	if deliveredAt != nil {
		delivered = spanner.NullTime{Time: deliveredAt.UTC(), Valid: true}
	}
	return s.updateLeased(ctx, buildStatement(recordWebhookProgressStmt,
		projectID, id, holder, cursorCreatedAt.UTC(), cursorEventID, delivered))
}

// RecordWebhookFailure implements [service.WebhookStatements].
func (s webhookStatements) RecordWebhookFailure(ctx context.Context, projectID, id, holder string, at time.Time, status *int32, nextAttemptAt time.Time) error {
	return s.updateLeased(ctx, buildStatement(recordWebhookFailureStmt,
		projectID, id, holder, at.UTC(), nullStatus(status), nextAttemptAt.UTC()))
}

// DisableFailedWebhook implements [service.WebhookStatements].
func (s webhookStatements) DisableFailedWebhook(ctx context.Context, projectID, id, holder string, at time.Time, status *int32) error {
	return s.updateLeased(ctx, buildStatement(disableFailedWebhookStmt,
		projectID, id, holder, at.UTC(), nullStatus(status)))
}

// ReleaseWebhookLease implements [service.WebhookStatements].
func (s webhookStatements) ReleaseWebhookLease(ctx context.Context, projectID, id, holder string, nextAttemptAt time.Time) error {
	return s.updateLeased(ctx, buildStatement(releaseWebhookLeaseStmt, projectID, id, holder, nextAttemptAt.UTC()))
}

// updateLeased runs a write on a webhook its holder has leased, or none when
// the holder no longer holds it: a *database.NoRowFoundError.
func (s webhookStatements) updateLeased(ctx context.Context, stmt spannerStatement) error {
	n, err := s.db.Update(ctx, stmt.statement())
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func nullStatus(status *int32) spanner.NullInt64 {
	if status == nil {
		return spanner.NullInt64{}
	}
	return spanner.NullInt64{Int64: int64(*status), Valid: true}
}

// writeOne runs a write that returns one webhook, or none when the project
// has no webhook of that id: a *database.NoRowFoundError.
func (s webhookStatements) writeOne(ctx context.Context, db queryExecutor, stmt spanner.Statement) (*domain.Webhook, error) {
	var entity *domain.Webhook
	if err := db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanWebhook)
		return err
	}); err != nil {
		return nil, err
	}
	return entity, nil
}

func scanWebhook(row *spanner.Row) (*domain.Webhook, error) {
	var (
		entity                  domain.Webhook
		previousSecret          spanner.NullString
		previousSecretExpiresAt spanner.NullTime
		lastDeliveredAt         spanner.NullTime
		lastErrorAt             spanner.NullTime
		lastErrorStatus         spanner.NullInt64
		nextAttemptAt           spanner.NullTime
		failingSince            spanner.NullTime
		leaseHolder             spanner.NullString
		leaseExpiresAt          spanner.NullTime
	)
	if err := row.Columns(
		&entity.ID,
		&entity.ProjectID,
		&entity.URL,
		&entity.Description,
		&entity.EventTypes,
		&entity.Enabled,
		&entity.Secret,
		&previousSecret,
		&previousSecretExpiresAt,
		&lastDeliveredAt,
		&lastErrorAt,
		&lastErrorStatus,
		&entity.CursorCreatedAt,
		&entity.CursorEventID,
		&entity.CreatedAt,
		&nextAttemptAt,
		&failingSince,
		&leaseHolder,
		&leaseExpiresAt,
	); err != nil {
		return nil, err
	}
	if entity.EventTypes == nil {
		entity.EventTypes = []string{}
	}
	if previousSecret.Valid {
		entity.PreviousSecret = &previousSecret.StringVal
	}
	entity.PreviousSecretExpiresAt = nullTimePtr(previousSecretExpiresAt)
	entity.LastDeliveredAt = nullTimePtr(lastDeliveredAt)
	entity.LastErrorAt = nullTimePtr(lastErrorAt)
	if lastErrorStatus.Valid {
		entity.LastErrorStatus = new(int32(lastErrorStatus.Int64))
	}
	entity.NextAttemptAt = nullTimePtr(nextAttemptAt)
	entity.FailingSince = nullTimePtr(failingSince)
	if leaseHolder.Valid {
		entity.LeaseHolder = &leaseHolder.StringVal
	}
	entity.LeaseExpiresAt = nullTimePtr(leaseExpiresAt)
	entity.CreatedAt, entity.CursorCreatedAt = entity.CreatedAt.UTC(), entity.CursorCreatedAt.UTC()
	return &entity, nil
}

func nullTimePtr(t spanner.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	return new(t.Time.UTC())
}

var _ service.WebhookStatements = (*webhookStatements)(nil)
