package sqlite

import (
	"context"
	"database/sql"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/invitation"
)

const (
	invitationColumns    = `project_id, id, type, payload, metadata, status, created_by, created_by_type, created_at, expires_at, journey_id, accepted_by, accepted_at, token_hash`
	createInvitationStmt = `INSERT INTO invitations` +
		` (project_id, id, type, payload, metadata, created_by, created_by_type, created_at, expires_at, journey_id, token_hash)` +
		` VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	invitationQuery              = `SELECT ` + invitationColumns + ` FROM invitations`
	getInvitationByTokenHashStmt = invitationQuery + ` WHERE token_hash = ?`
	changeInvitationStatusStmt   = `UPDATE invitations SET status = ?, accepted_by = ?, accepted_at = ?, metadata = NULL` +
		` WHERE project_id = ? AND id = ? AND status = 'pending' AND expires_at > ?` +
		` RETURNING ` + invitationColumns
	deleteUnacceptedInvitationStmt = `DELETE FROM invitations` +
		` WHERE project_id = ? AND id = ? AND status <> 'accepted'`
	deletePendingInvitationStmt = `DELETE FROM invitations` +
		` WHERE project_id = ? AND id = ? AND status = 'pending' AND expires_at > ?`
	countPendingInvitationsStmt = `SELECT count(*) FROM invitations` +
		` WHERE project_id = ? AND status = 'pending' AND expires_at > ?`
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
	now := nowUnixNano()
	if _, err := s.client.Exec(ctx, createInvitationStmt,
		entity.ProjectID,
		entity.ID,
		string(entity.Type),
		string(payload),
		entity.EncryptedMetadata,
		entity.CreatedBy,
		invitation.CreatedByType(entity),
		now,
		entity.ExpiresAt.UnixNano(),
		entity.JourneyID,
		entity.TokenHash,
	); err != nil {
		return wrapError(err)
	}
	entity.CreatedAt = timeFromUnixNano(now)
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
		defer rows.Close()
		items, err := collectRows(rows, scanInvitation)
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
	acceptedAt, err := invitation.StatusChange(status, acceptedBy, now)
	if err != nil {
		return nil, err
	}
	return s.queryOne(ctx, changeInvitationStatusStmt,
		string(status), acceptedBy, nullUnixNano(acceptedAt), projectID, id, now.UnixNano(),
	)
}

// DeleteUnacceptedInvitation implements [service.InvitationStatements].
func (s invitationStatements) DeleteUnacceptedInvitation(ctx context.Context, projectID, id string) error {
	return s.execOne(ctx, deleteUnacceptedInvitationStmt, projectID, id)
}

// DeletePendingInvitation implements [service.InvitationStatements].
func (s invitationStatements) DeletePendingInvitation(ctx context.Context, projectID, id string, now time.Time) error {
	return s.execOne(ctx, deletePendingInvitationStmt, projectID, id, now.UnixNano())
}

// CountPendingInvitations implements [service.InvitationStatements].
func (s invitationStatements) CountPendingInvitations(ctx context.Context, projectID string, now time.Time) (int64, error) {
	var count int64
	if err := s.client.QueryRow(ctx, countPendingInvitationsStmt, projectID, now.UnixNano()).Scan(&count); err != nil {
		return 0, wrapError(err)
	}
	return count, nil
}

func (s invitationStatements) queryOne(ctx context.Context, query string, args ...any) (*domain.Invitation, error) {
	rows, err := s.client.Query(ctx, query, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	entity, err := collectExactlyOneRow(rows, scanInvitation)
	if err != nil {
		return nil, wrapError(err)
	}
	return entity, nil
}

func (s invitationStatements) execOne(ctx context.Context, query string, args ...any) error {
	n, err := execAffected(ctx, s.client, query, args...)
	if err != nil {
		return err
	}
	if n == 0 {
		return database.NewNoRowFoundError(nil)
	}
	return nil
}

func scanInvitation(rows *sql.Rows) (*domain.Invitation, error) {
	var (
		scanned        invitation.Row
		payload        string
		createdNano    int64
		expiresNano    int64
		acceptedAtNano sql.NullInt64
	)
	if err := rows.Scan(
		&scanned.ProjectID,
		&scanned.ID,
		&scanned.Type,
		&payload,
		&scanned.EncryptedMetadata,
		&scanned.Status,
		&scanned.CreatedBy,
		&scanned.CreatedByType,
		&createdNano,
		&expiresNano,
		&scanned.JourneyID,
		&scanned.AcceptedBy,
		&acceptedAtNano,
		&scanned.TokenHash,
	); err != nil {
		return nil, err
	}
	scanned.Payload = []byte(payload)
	scanned.CreatedAt = timeFromUnixNano(createdNano)
	scanned.ExpiresAt = timeFromUnixNano(expiresNano)
	if acceptedAtNano.Valid {
		scanned.AcceptedAt = new(timeFromUnixNano(acceptedAtNano.Int64))
	}
	return invitation.ToDomain(scanned)
}

var _ service.InvitationStatements = (*invitationStatements)(nil)
