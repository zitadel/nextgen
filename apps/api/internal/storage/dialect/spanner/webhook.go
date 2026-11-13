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
)

var webhookCursorColumns = []string{"project_id", "id", "cursor_created_at", "cursor_event_id"}

type webhookStatements struct{ statement }

func newWebhookStatements(db queryExecutor) webhookStatements {
	return webhookStatements{statement: statement{db: db}}
}

// cursorAtNow moves the webhook's cursor to the commit timestamp of the
// transaction it is buffered in, the clock that stamps events.created_at
// (InsertEvent): an event that commits later sorts after it, and none that
// committed earlier does. An event of the same transaction shares the
// timestamp and sorts after the empty id, so it is delivered.
//
// It is a mutation, applied at commit after the transaction's DML, not
// PENDING_COMMIT_TIMESTAMP() in that DML: a table written with it cannot be
// read for the rest of its transaction, nor can THEN RETURN hand back the
// row.
func cursorAtNow(ctx context.Context, tx queryExecutor, projectID, id string) error {
	_, err := tx.BufferWrite(ctx, []*spanner.Mutation{
		spanner.Update(webhookTable, webhookCursorColumns,
			[]any{projectID, id, spanner.CommitTimestamp, ""}),
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
		// one it replaces.
		entity.CursorCreatedAt, entity.CursorEventID = time.Time{}, ""
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
