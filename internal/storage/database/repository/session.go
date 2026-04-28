package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Session struct{}

type sessionRow struct {
	ProjectID       string
	ID              string
	Version         int64
	State           string
	UserID          database.Null[string]
	Factors         JSON[map[string]any]
	AssuranceLevels []string
	Metadata        JSON[map[string]any]
	UserAgent       JSON[map[string]any]
	CreatedAt       time.Time
	ExpiresAt       database.Null[time.Time]
}

func (s sessionRow) toDomain() *domain.Session {
	session := &domain.Session{
		ProjectID:       s.ProjectID,
		ID:              s.ID,
		Version:         s.Version,
		State:           domain.SessionState(s.State),
		Factors:         s.Factors.Value,
		AssuranceLevels: s.AssuranceLevels,
		Metadata:        s.Metadata.Value,
		UserAgent:       s.UserAgent.Value,
		CreatedAt:       s.CreatedAt,
	}
	if s.UserID.Valid {
		session.UserID = &s.UserID.V
	}
	if s.ExpiresAt.Valid {
		session.ExpiresAt = &s.ExpiresAt.V
	}
	if session.Factors == nil {
		session.Factors = map[string]any{}
	}
	if session.Metadata == nil {
		session.Metadata = map[string]any{}
	}
	if session.AssuranceLevels == nil {
		session.AssuranceLevels = []string{}
	}
	return session
}

const sessionColumns = `project_id, id, version, state, user_id, factors, assurance_levels, metadata, user_agent, created_at, expires_at`

const sessionCreateStmt = `INSERT INTO zitadel_nextgen.sessions (` + sessionColumns + `)` +
	` VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW()), $11)` +
	` RETURNING ` + sessionColumns

// Create implements [domain.SessionRepository].
func (s *Session) Create(ctx context.Context, client database.QueryExecutor, session *domain.Session) error {
	if session == nil {
		return fmt.Errorf("session must not be nil")
	}
	if session.State == "" {
		session.State = domain.SessionStateBuilding
	}
	if session.Version == 0 {
		session.Version = 1
	}
	if session.Factors == nil {
		session.Factors = map[string]any{}
	}
	if session.Metadata == nil {
		session.Metadata = map[string]any{}
	}
	if session.AssuranceLevels == nil {
		session.AssuranceLevels = []string{}
	}
	factorsJSON, err := json.Marshal(session.Factors)
	if err != nil {
		return fmt.Errorf("failed to marshal session factors: %w", err)
	}
	metadataJSON, err := json.Marshal(session.Metadata)
	if err != nil {
		return fmt.Errorf("failed to marshal session metadata: %w", err)
	}
	userAgentJSON, err := json.Marshal(session.UserAgent)
	if err != nil {
		return fmt.Errorf("failed to marshal session user agent: %w", err)
	}
	row := client.QueryRow(ctx, sessionCreateStmt,
		session.ProjectID,
		session.ID,
		session.Version,
		session.State,
		session.UserID,
		factorsJSON,
		session.AssuranceLevels,
		metadataJSON,
		zeroMapToNil(userAgentJSON, session.UserAgent),
		zeroTimeToNil(session.CreatedAt),
		session.ExpiresAt,
	)
	return scanSessionRow(row, session)
}

const sessionGetStmt = `SELECT ` + sessionColumns + ` FROM zitadel_nextgen.sessions WHERE project_id = $1 AND id = $2`

// Get implements [domain.SessionRepository].
func (s *Session) Get(ctx context.Context, client database.QueryExecutor, projectID, sessionID string) (*domain.Session, error) {
	row := client.QueryRow(ctx, sessionGetStmt, projectID, sessionID)
	var session domain.Session
	err := scanSessionRow(row, &session)
	if err != nil {
		return nil, err
	}
	return &session, nil
}

const sessionRevokeStmt = `UPDATE zitadel_nextgen.sessions SET state = $3, version = version + 1` +
	` WHERE project_id = $1 AND id = $2`

// Revoke implements [domain.SessionRepository].
func (s *Session) Revoke(ctx context.Context, client database.QueryExecutor, projectID, sessionID string) error {
	_, err := client.Exec(ctx, sessionRevokeStmt, projectID, sessionID, domain.SessionStateRevoked)
	return err
}

const sessionListBaseStmt = `SELECT ` + sessionColumns + ` FROM zitadel_nextgen.sessions`
const sessionListCountBaseStmt = `SELECT COUNT(*) FROM zitadel_nextgen.sessions`

// List implements [domain.SessionRepository].
func (s *Session) List(ctx context.Context, client database.QueryExecutor, filter domain.SessionListFilter) ([]*domain.Session, uint64, error) {
	var (
		whereBuilder strings.Builder
		args         []any
	)
	appendFilter := func(expr string, value any) {
		if whereBuilder.Len() == 0 {
			whereBuilder.WriteString(" WHERE ")
		} else {
			whereBuilder.WriteString(" AND ")
		}
		whereBuilder.WriteString(expr)
		args = append(args, value)
	}
	appendFilter("project_id = $1", filter.ProjectID)
	if filter.UserID != nil {
		appendFilter(fmt.Sprintf("user_id = $%d", len(args)+1), *filter.UserID)
	}
	if filter.State != nil {
		appendFilter(fmt.Sprintf("state = $%d", len(args)+1), *filter.State)
	}

	countStmt := sessionListCountBaseStmt + whereBuilder.String()
	var total uint64
	if err := client.QueryRow(ctx, countStmt, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	queryBuilder := strings.Builder{}
	queryBuilder.WriteString(sessionListBaseStmt)
	queryBuilder.WriteString(whereBuilder.String())
	queryBuilder.WriteString(" ORDER BY created_at DESC, id ASC")
	if filter.Limit > 0 {
		queryBuilder.WriteString(fmt.Sprintf(" LIMIT $%d", len(args)+1))
		args = append(args, filter.Limit)
	}
	if filter.Offset > 0 {
		queryBuilder.WriteString(fmt.Sprintf(" OFFSET $%d", len(args)+1))
		args = append(args, filter.Offset)
	}

	rows, err := client.Query(ctx, queryBuilder.String(), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	sessions := make([]*domain.Session, 0)
	for rows.Next() {
		var scan sessionRow
		if err = rows.Scan(
			&scan.ProjectID,
			&scan.ID,
			&scan.Version,
			&scan.State,
			&scan.UserID,
			&scan.Factors,
			&scan.AssuranceLevels,
			&scan.Metadata,
			&scan.UserAgent,
			&scan.CreatedAt,
			&scan.ExpiresAt,
		); err != nil {
			return nil, 0, fmt.Errorf("failed to scan session row: %w", err)
		}
		sessions = append(sessions, scan.toDomain())
	}
	if err = rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("failed to read session rows: %w", err)
	}
	return sessions, total, nil
}

func scanSessionRow(row database.Row, target *domain.Session) error {
	var scan sessionRow
	err := row.Scan(
		&scan.ProjectID,
		&scan.ID,
		&scan.Version,
		&scan.State,
		&scan.UserID,
		&scan.Factors,
		&scan.AssuranceLevels,
		&scan.Metadata,
		&scan.UserAgent,
		&scan.CreatedAt,
		&scan.ExpiresAt,
	)
	if err != nil {
		return err
	}
	*target = *scan.toDomain()
	return nil
}

func zeroTimeToNil(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	return &value
}

func zeroMapToNil(data []byte, source map[string]any) any {
	if source == nil {
		return nil
	}
	return data
}

var _ domain.SessionRepository = (*Session)(nil)
