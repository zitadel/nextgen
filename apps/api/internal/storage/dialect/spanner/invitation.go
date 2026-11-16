package spanner

import (
	"context"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/invitation"
)

const (
	invitationTable      = "invitations"
	invitationColumnList = `project_id, id, type, payload, metadata, status, created_by, created_by_type, created_at, expires_at, journey_id, accepted_by, accepted_at, token_hash`
	createInvitationStmt = `INSERT INTO invitations` +
		` (project_id, id, type, payload, metadata, created_by, created_by_type, expires_at, journey_id, token_hash)` +
		` VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10) THEN RETURN created_at`
	invitationQuery              = `SELECT ` + invitationColumnList + ` FROM invitations`
	getInvitationByTokenHashStmt = invitationQuery + ` WHERE token_hash = @p1`
	changeInvitationStatusStmt   = `UPDATE invitations SET status = @p3, accepted_by = @p4, accepted_at = @p5, metadata = NULL` +
		` WHERE project_id = @p1 AND id = @p2 AND status = 'pending' AND expires_at > @p6` +
		` THEN RETURN ` + invitationColumnList
	deleteUnacceptedInvitationStmt = `DELETE FROM invitations` +
		` WHERE project_id = @p1 AND id = @p2 AND status <> 'accepted'`
	deletePendingInvitationStmt = `DELETE FROM invitations` +
		` WHERE project_id = @p1 AND id = @p2 AND status = 'pending' AND expires_at > @p3`
	countPendingInvitationsStmt = `SELECT COUNT(*) FROM invitations` +
		` WHERE project_id = @p1 AND status = 'pending' AND expires_at > @p2`
)

var invitationColumns = []string{
	"project_id", "id", "type", "payload", "metadata", "status", "created_by", "created_by_type",
	"created_at", "expires_at", "journey_id", "accepted_by", "accepted_at", "token_hash",
}

type invitationStatements struct{ statement }

func newInvitationStatements(db queryExecutor) invitationStatements {
	return invitationStatements{statement: statement{db: db}}
}

// CreateInvitation implements [service.InvitationStatements].
func (s invitationStatements) CreateInvitation(ctx context.Context, entity *domain.Invitation) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixInvitation); err != nil {
		return err
	}
	rawPayload, err := invitation.MarshalPayload(entity)
	if err != nil {
		return err
	}
	payload, err := encodeNullJSON(rawPayload)
	if err != nil {
		return err
	}
	stmt := buildStatement(createInvitationStmt,
		entity.ProjectID,
		entity.ID,
		string(entity.Type),
		payload,
		spannerNullString(entity.EncryptedMetadata),
		spannerNullString(entity.CreatedBy),
		spannerNullString(invitation.CreatedByType(entity)),
		entity.ExpiresAt,
		entity.JourneyID,
		entity.TokenHash,
	).statement()
	if err := s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&entity.CreatedAt)
		})
		return err
	}); err != nil {
		return err
	}
	entity.CreatedAt = entity.CreatedAt.UTC()
	entity.Status = domain.InvitationStatusPending
	return nil
}

// GetInvitationByID implements [service.InvitationStatements].
func (s invitationStatements) GetInvitationByID(ctx context.Context, projectID, id string) (*domain.Invitation, error) {
	row, err := s.db.ReadRow(ctx, invitationTable, spanner.Key{projectID, id}, invitationColumns)
	if err != nil {
		return nil, err
	}
	return scanInvitation(row)
}

// GetInvitationByTokenHash implements [service.InvitationStatements].
func (s invitationStatements) GetInvitationByTokenHash(ctx context.Context, tokenHash string) (*domain.Invitation, error) {
	return s.queryOne(ctx, buildStatement(getInvitationByTokenHashStmt, tokenHash).statement())
}

// ListInvitations implements [service.InvitationStatements].
func (s invitationStatements) ListInvitations(ctx context.Context, filter *database.ListOptions[domain.InvitationField]) (*database.ListResult[*domain.Invitation], error) {
	items, nextCursor, err := pagination.Page(filter.Pagination, invitation.Schema, func(limit uint32) ([]*domain.Invitation, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileList(ctx, &compiler, invitationQuery, filter, invitation.Schema, "", ""); err != nil {
			return nil, err
		}
		var items []*domain.Invitation
		if err := s.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
			var err error
			items, err = collectRows(iter, scanInvitation)
			return err
		}); err != nil {
			return nil, err
		}
		return items, nil
	})
	if err != nil {
		return nil, err
	}
	return &database.ListResult[*domain.Invitation]{Items: items, NextCursor: nextCursor}, nil
}

// ChangeInvitationStatus implements [service.InvitationStatements].
func (s invitationStatements) ChangeInvitationStatus(ctx context.Context, projectID, id string, status domain.InvitationStatus, acceptedBy *string, now time.Time) (*domain.Invitation, error) {
	acceptedAt, err := invitation.StatusChange(status, acceptedBy, now)
	if err != nil {
		return nil, err
	}
	stmt := buildStatement(changeInvitationStatusStmt,
		projectID, id, string(status), spannerNullString(acceptedBy), spannerNullTime(acceptedAt), now,
	).statement()
	var entity *domain.Invitation
	if err := s.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanInvitation)
		return err
	}); err != nil {
		return nil, err
	}
	return entity, nil
}

// DeleteUnacceptedInvitation implements [service.InvitationStatements].
func (s invitationStatements) DeleteUnacceptedInvitation(ctx context.Context, projectID, id string) error {
	return s.updateOne(ctx, buildStatement(deleteUnacceptedInvitationStmt, projectID, id).statement())
}

// DeletePendingInvitation implements [service.InvitationStatements].
func (s invitationStatements) DeletePendingInvitation(ctx context.Context, projectID, id string, now time.Time) error {
	return s.updateOne(ctx, buildStatement(deletePendingInvitationStmt, projectID, id, now).statement())
}

// CountPendingInvitations implements [service.InvitationStatements].
func (s invitationStatements) CountPendingInvitations(ctx context.Context, projectID string, now time.Time) (int64, error) {
	var count int64
	if err := s.db.Query(ctx, buildStatement(countPendingInvitationsStmt, projectID, now).statement(), func(iter *spanner.RowIterator) error {
		var err error
		count, err = collectOneRow(iter, func(row *spanner.Row) (int64, error) {
			var n int64
			return n, row.Columns(&n)
		})
		return err
	}); err != nil {
		return 0, err
	}
	return count, nil
}

func (s invitationStatements) queryOne(ctx context.Context, stmt spanner.Statement) (*domain.Invitation, error) {
	var entity *domain.Invitation
	if err := s.db.Query(ctx, stmt, func(iter *spanner.RowIterator) error {
		var err error
		entity, err = collectOneRow(iter, scanInvitation)
		return err
	}); err != nil {
		return nil, err
	}
	return entity, nil
}

func (s invitationStatements) updateOne(ctx context.Context, stmt spanner.Statement) error {
	n, err := s.db.Update(ctx, stmt)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanInvitation(row *spanner.Row) (*domain.Invitation, error) {
	var (
		scanned       invitation.Row
		payload       spanner.NullJSON
		metadata      spanner.NullString
		createdBy     spanner.NullString
		createdByType spanner.NullString
		acceptedBy    spanner.NullString
		acceptedAt    spanner.NullTime
	)
	if err := row.Columns(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.Type,
		&payload,
		&metadata,
		&scanned.Status,
		&createdBy,
		&createdByType,
		&scanned.CreatedAt,
		&scanned.ExpiresAt,
		&scanned.JourneyID,
		&acceptedBy,
		&acceptedAt,
		&scanned.TokenHash,
	); err != nil {
		return nil, err
	}
	rawPayload, err := decodeNullJSON(payload)
	if err != nil {
		return nil, err
	}
	scanned.Payload = rawPayload
	scanned.EncryptedMetadata = spannerNullStringPtr(metadata)
	scanned.CreatedBy = spannerNullStringPtr(createdBy)
	scanned.CreatedByType = spannerNullStringPtr(createdByType)
	scanned.AcceptedBy = spannerNullStringPtr(acceptedBy)
	if acceptedAt.Valid {
		scanned.AcceptedAt = &acceptedAt.Time
	}
	return invitation.ToDomain(scanned)
}

var _ service.InvitationStatements = (*invitationStatements)(nil)
