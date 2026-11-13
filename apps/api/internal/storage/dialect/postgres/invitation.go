package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/invitation"
)

const (
	invitationColumns    = `project_id, id, type, payload, metadata, status, created_by, created_by_type, created_at, expires_at, journey_id, accepted_by, accepted_at, rejected_at, token_hash`
	createInvitationStmt = `INSERT INTO zitadel_nextgen.invitations` +
		` (project_id, id, type, payload, metadata, created_by, created_by_type, expires_at, journey_id, token_hash)` +
		` VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING created_at`
	invitationQuery              = `SELECT ` + invitationColumns + ` FROM zitadel_nextgen.invitations`
	getInvitationByTokenHashStmt = invitationQuery + ` WHERE token_hash = $1`
	// Accept clears the metadata; a decline keeps it for the administrators.
	changeInvitationStatusStmt = `UPDATE zitadel_nextgen.invitations` +
		` SET status = $3, accepted_by = $4, accepted_at = $5, rejected_at = $6,` +
		` metadata = CASE WHEN $3 = 'accepted' THEN NULL ELSE metadata END` +
		` WHERE project_id = $1 AND id = $2 AND status = 'pending' AND expires_at > $7` +
		` RETURNING ` + invitationColumns
	deleteUnacceptedInvitationStmt = `DELETE FROM zitadel_nextgen.invitations` +
		` WHERE project_id = $1 AND id = $2 AND status <> 'accepted'`
	deleteCancellableInvitationStmt = `DELETE FROM zitadel_nextgen.invitations` +
		` WHERE project_id = $1 AND id = $2 AND (status = 'rejected' OR (status = 'pending' AND expires_at > $3))`
	countPendingInvitationsStmt = `SELECT count(*) FROM zitadel_nextgen.invitations` +
		` WHERE project_id = $1 AND status = 'pending' AND expires_at > $2`
)

type invitationStatements struct{ statement }

func newInvitationStatements(client queryExecutor) invitationStatements {
	return invitationStatements{statement: statement{client: client}}
}

// CreateInvitation implements [service.InvitationStatements].
func (s invitationStatements) CreateInvitation(ctx context.Context, entity *domain.Invitation) error {
	if err := ensureManagedID(&entity.ID, domain.PrefixInvitation); err != nil {
		return err
	}
	payload, err := invitation.MarshalPayload(entity)
	if err != nil {
		return err
	}
	if err := s.client.QueryRow(ctx, createInvitationStmt,
		entity.ProjectID,
		entity.ID,
		string(entity.Type),
		payload,
		entity.EncryptedMetadata,
		entity.CreatedBy,
		invitation.CreatedByType(entity),
		entity.ExpiresAt,
		entity.JourneyID,
		entity.TokenHash,
	).Scan(&entity.CreatedAt); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = entity.CreatedAt.UTC()
	entity.Status = domain.InvitationStatusPending
	return nil
}

// GetInvitationByID implements [service.InvitationStatements].
func (s invitationStatements) GetInvitationByID(ctx context.Context, projectID, id string) (*domain.Invitation, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, invitationQuery, &database.ListOptions[domain.InvitationField]{
		Filter: database.And(
			database.Equal(database.Col(domain.InvitationFieldProjectID), projectID),
			database.Equal(database.Col(domain.InvitationFieldID), id),
		),
	}, invitation.Schema); err != nil {
		return nil, err
	}
	return s.queryOne(ctx, compiler.String(), compiler.args...)
}

// GetInvitationByTokenHash implements [service.InvitationStatements].
func (s invitationStatements) GetInvitationByTokenHash(ctx context.Context, tokenHash string) (*domain.Invitation, error) {
	return s.queryOne(ctx, getInvitationByTokenHashStmt, tokenHash)
}

// ListInvitations implements [service.InvitationStatements].
func (s invitationStatements) ListInvitations(ctx context.Context, filter *database.ListOptions[domain.InvitationField]) (*database.ListResult[*domain.Invitation], error) {
	items, nextCursor, err := pagination.Page(filter.Pagination, invitation.Schema, func(limit uint32) ([]*domain.Invitation, error) {
		filter := filter.WithLimit(limit)
		var compiler statementCompiler
		if err := compileList(ctx, &compiler, invitationQuery, filter, invitation.Schema, "", ""); err != nil {
			return nil, err
		}
		rows, err := s.client.Query(ctx, compiler.String(), compiler.args...)
		if err != nil {
			return nil, wrapError(err)
		}
		items, err := pgx.CollectRows(rows, scanInvitation)
		if err != nil {
			return nil, wrapError(err)
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
	acceptedAt, rejectedAt, err := invitation.StatusChange(status, acceptedBy, now)
	if err != nil {
		return nil, err
	}
	return s.queryOne(ctx, changeInvitationStatusStmt, projectID, id, string(status), acceptedBy, acceptedAt, rejectedAt, now)
}

// DeleteUnacceptedInvitation implements [service.InvitationStatements].
func (s invitationStatements) DeleteUnacceptedInvitation(ctx context.Context, projectID, id string) error {
	return s.execOne(ctx, deleteUnacceptedInvitationStmt, projectID, id)
}

// DeleteCancellableInvitation implements [service.InvitationStatements].
func (s invitationStatements) DeleteCancellableInvitation(ctx context.Context, projectID, id string, now time.Time) error {
	return s.execOne(ctx, deleteCancellableInvitationStmt, projectID, id, now)
}

// CountPendingInvitations implements [service.InvitationStatements].
func (s invitationStatements) CountPendingInvitations(ctx context.Context, projectID string, now time.Time) (int64, error) {
	var count int64
	if err := s.client.QueryRow(ctx, countPendingInvitationsStmt, projectID, now).Scan(&count); err != nil {
		return 0, wrapError(err)
	}
	return count, nil
}

func (s invitationStatements) queryOne(ctx context.Context, sql string, args ...any) (*domain.Invitation, error) {
	rows, err := s.client.Query(ctx, sql, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	entity, err := pgx.CollectExactlyOneRow(rows, scanInvitation)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

func (s invitationStatements) execOne(ctx context.Context, sql string, args ...any) error {
	tag, err := s.client.Exec(ctx, sql, args...)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanInvitation(row pgx.CollectableRow) (*domain.Invitation, error) {
	var scanned invitation.Row
	if err := row.Scan(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.Type,
		&scanned.Payload,
		&scanned.EncryptedMetadata,
		&scanned.Status,
		&scanned.CreatedBy,
		&scanned.CreatedByType,
		&scanned.CreatedAt,
		&scanned.ExpiresAt,
		&scanned.JourneyID,
		&scanned.AcceptedBy,
		&scanned.AcceptedAt,
		&scanned.RejectedAt,
		&scanned.TokenHash,
	); err != nil {
		return nil, err
	}
	return invitation.ToDomain(scanned)
}

var _ service.InvitationStatements = (*invitationStatements)(nil)
