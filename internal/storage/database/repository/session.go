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

const sessionsTable = "zitadel_nextgen.sessions"

var (
	sessionColProjectID = database.NewColumn(sessionsTable, "project_id")
	sessionColID        = database.NewColumn(sessionsTable, "id")

	sessionColCreatedAt = database.NewColumn(sessionsTable, "created_at")
	sessionColUpdatedAt = database.NewColumn(sessionsTable, "updated_at")
	sessionColExpiresAt = database.NewColumn(sessionsTable, "expires_at")

	sessionColToken = database.NewColumn(sessionsTable, "token")

	sessionColUserID    = database.NewColumn(sessionsTable, "user_id")
	sessionColUserAgent = database.NewColumn(sessionsTable, "user_agent")
	sessionColFactors   = database.NewColumn(sessionsTable, "factors")
)

var sessionAllowedUpdateColumns = []database.Column{
	sessionColUserID,
	sessionColUserAgent,
	sessionColFactors,
	sessionColExpiresAt,
}

type sessionFactorJSON struct {
	Type       domain.AuthCheckType `json:"type"`
	VerifiedAt time.Time            `json:"verified_at"`
	Factor     any                  `json:"factor,omitempty"`
}

func (Session) qualifiedTableName() string {
	return sessionsTable
}

func (Session) PrimaryKeyColumns() []database.Column {
	return []database.Column{sessionColProjectID, sessionColID}
}

func (Session) UpdatedAtColumn() database.Column {
	return sessionColUpdatedAt
}

const sessionGetSelect = `SELECT project_id, id, created_at, updated_at, expires_at, token, user_id, user_agent, factors` +
	` FROM zitadel_nextgen.sessions`

const sessionGetByIDStmt = sessionGetSelect +
	` WHERE project_id = $1 AND id = $2`

const sessionGetByTokenStmt = sessionGetSelect +
	` WHERE project_id = $1 AND token = $2`

// SetExpiresAt implements [domain.SessionRepository].
func (s *Session) SetExpiresAt(expiresAt time.Time) database.Change {
	return database.NewChange(sessionColExpiresAt, expiresAt)
}

// SetFactors implements [domain.SessionRepository].
func (s *Session) SetFactors(factors ...*domain.SessionFactor) database.Change {
	payload := make([]sessionFactorJSON, 0, len(factors))
	for _, factor := range factors {
		if factor == nil {
			continue
		}
		payload = append(payload, sessionFactorJSON{
			Type:       factor.Type,
			VerifiedAt: factor.VerifiedAt,
			Factor:     factor.Factor,
		})
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return nil
	}

	return database.NewChangeToStatement(sessionColFactors, func(builder *database.StatementBuilder) {
		builder.WriteArg(raw)
		builder.WriteString("::JSONB")
	})
}

// SetUserAgent implements [domain.SessionRepository].
func (s *Session) SetUserAgent(userAgent map[string]any) database.Change {
	if userAgent == nil {
		return database.NewChangeToNull(sessionColUserAgent)
	}

	raw, err := json.Marshal(userAgent)
	if err != nil {
		return nil
	}

	return database.NewChangeToStatement(sessionColUserAgent, func(builder *database.StatementBuilder) {
		builder.WriteArg(raw)
		builder.WriteString("::JSONB")
	})
}

// SetUserID implements [domain.SessionRepository].
func (s *Session) SetUserID(userID string) database.Change {
	return database.NewChange(sessionColUserID, userID)
}

const sessionCreateStmt = `INSERT INTO zitadel_nextgen.sessions` +
	` (project_id, id, token, user_id, user_agent, factors, expires_at)` +
	` VALUES ($1, $2, $3, $4, $5::JSONB, $6::JSONB, $7)` +
	` RETURNING created_at, updated_at`

// Create implements [domain.SessionRepository].
func (s *Session) Create(ctx context.Context, client database.QueryExecutor, session *domain.Session) error {
	if session == nil {
		return fmt.Errorf("failed to create session: session is required")
	}
	if session.ProjectID == "" {
		return fmt.Errorf("failed to create session: project id is required")
	}
	if session.ID == "" {
		return fmt.Errorf("failed to create session: session id is required")
	}
	if session.Token == "" {
		return fmt.Errorf("failed to create session: token is required")
	}

	userAgentRaw, err := json.Marshal(session.UserAgent)
	if err != nil {
		return fmt.Errorf("failed to create session: failed to marshal user agent: %w", err)
	}

	factorsRaw, err := marshalSessionFactors(session.Factors)
	if err != nil {
		return fmt.Errorf("failed to create session: failed to marshal factors: %w", err)
	}

	var userID *string
	if session.UserID != nil {
		userID = session.UserID
	}

	err = client.QueryRow(ctx, sessionCreateStmt,
		session.ProjectID,
		session.ID,
		session.Token,
		userID,
		userAgentRaw,
		factorsRaw,
		nullableExpiresAt(session.ExpiresAt),
	).Scan(&session.CreatedAt, &session.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}

	return nil
}

// Delete implements [domain.SessionRepository].
func (s *Session) Delete(ctx context.Context, client database.QueryExecutor, projectID string, sessionID string) error {
	condition := database.And(
		database.NewTextCondition(sessionColProjectID, database.TextOperationEqual, projectID),
		database.NewTextCondition(sessionColID, database.TextOperationEqual, sessionID),
	)

	_, err := deleteOne(ctx, client, Session{}, condition)
	if err != nil {
		return fmt.Errorf("failed to delete session: %w", err)
	}
	return nil
}

// GetByID implements [domain.SessionRepository].
func (s *Session) GetByID(ctx context.Context, client database.QueryExecutor, projectID string, sessionID string) (*domain.Session, error) {
	return s.get(ctx, client, sessionGetByIDStmt, projectID, sessionID)
}

// GetByToken implements [domain.SessionRepository].
func (s *Session) GetByToken(ctx context.Context, client database.QueryExecutor, projectID string, token string) (*domain.Session, error) {
	return s.get(ctx, client, sessionGetByTokenStmt, projectID, token)
}

// Update implements [domain.SessionRepository].
func (s *Session) Update(ctx context.Context, client database.QueryExecutor, projectID string, sessionID string, token string, changes ...database.Change) (*domain.Session, error) {
	if token == "" {
		return nil, fmt.Errorf("failed to update session: token is required")
	}
	if len(changes) == 0 {
		return nil, database.ErrNoChanges
	}
	if err := validateSessionChanges(changes); err != nil {
		return nil, fmt.Errorf("failed to update session: %w", err)
	}

	condition := database.And(
		database.NewTextCondition(sessionColProjectID, database.TextOperationEqual, projectID),
		database.NewTextCondition(sessionColID, database.TextOperationEqual, sessionID),
	)
	changes = append(
		changes,
		database.NewChange(sessionColToken, token),
		database.NewChange(sessionColUpdatedAt, database.NowInstruction),
	)

	builder := database.NewStatementBuilder("UPDATE ")
	builder.WriteString(sessionsTable)
	builder.WriteString(" SET ")
	if err := database.Changes(changes).Write(builder); err != nil {
		return nil, fmt.Errorf("failed to update session: %w", err)
	}
	writeCondition(builder, condition)

	rowsAffected, err := client.Exec(ctx, builder.String(), builder.Args()...)
	if err != nil {
		return nil, fmt.Errorf("failed to update session: %w", err)
	}
	if rowsAffected == 0 {
		return nil, fmt.Errorf("failed to update session: session does not exist")
	}

	updated, err := s.GetByID(ctx, client, projectID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to update session: failed to fetch updated session: %w", err)
	}
	return updated, nil
}

func (s *Session) get(ctx context.Context, client database.QueryExecutor, query, projectID, matcher string) (*domain.Session, error) {
	rows, err := client.Query(ctx, query, projectID, matcher)
	if err != nil {
		return nil, fmt.Errorf("failed to query session: %w", err)
	}
	defer rows.Close()

	stored := new(domain.Session)
	for rows.Next() {
		var (
			expiresAt   database.Null[time.Time]
			userID      database.Null[string]
			userAgent   []byte
			factorsJSON []byte
		)

		err = rows.Scan(
			&stored.ProjectID,
			&stored.ID,
			&stored.CreatedAt,
			&stored.UpdatedAt,
			&expiresAt,
			&stored.Token,
			&userID,
			&userAgent,
			&factorsJSON,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan session: %w", err)
		}

		if expiresAt.Valid {
			stored.ExpiresAt = expiresAt.V
		}
		if userID.Valid {
			stored.UserID = &userID.V
		}
		if len(userAgent) > 0 && string(userAgent) != "null" {
			if err := json.Unmarshal(userAgent, &stored.UserAgent); err != nil {
				return nil, fmt.Errorf("failed to decode session user agent: %w", err)
			}
		}

		stored.Factors, err = unmarshalSessionFactors(factorsJSON)
		if err != nil {
			return nil, fmt.Errorf("failed to decode session factors: %w", err)
		}
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to read session rows: %w", err)
	}

	return stored, nil
}

func validateSessionChanges(changes []database.Change) error {
	for _, change := range changes {
		if change == nil {
			return fmt.Errorf("change must not be nil")
		}

		valid := false
		for _, col := range sessionAllowedUpdateColumns {
			if change.IsOnColumn(col) {
				valid = true
				break
			}
		}

		if !valid {
			return fmt.Errorf("unsupported session change")
		}
	}
	return nil
}

func marshalSessionFactors(factors []*domain.SessionFactor) ([]byte, error) {
	serialized := make([]sessionFactorJSON, 0, len(factors))
	for _, factor := range factors {
		if factor == nil {
			continue
		}
		serialized = append(serialized, sessionFactorJSON{
			Type:       factor.Type,
			VerifiedAt: factor.VerifiedAt,
			Factor:     factor.Factor,
		})
	}
	return json.Marshal(serialized)
}

func unmarshalSessionFactors(raw []byte) ([]*domain.SessionFactor, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" || trimmed == "{}" {
		return nil, nil
	}

	var deserialized []sessionFactorJSON
	if err := json.Unmarshal(raw, &deserialized); err != nil {
		return nil, err
	}

	factors := make([]*domain.SessionFactor, 0, len(deserialized))
	for _, factor := range deserialized {
		factors = append(factors, &domain.SessionFactor{
			Type:       factor.Type,
			VerifiedAt: factor.VerifiedAt,
			Factor:     factor.Factor,
		})
	}
	return factors, nil
}

func nullableExpiresAt(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}

var _ domain.SessionRepository = (*Session)(nil)
