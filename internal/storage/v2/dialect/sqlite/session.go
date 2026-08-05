package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	v2session "github.com/zitadel/nextgen/internal/storage/v2/session"
)

const sessionQuery = `SELECT s.project_id, s.id, s.created_at, s.updated_at, s.expires_at, s.time_to_live, s.token_id, s.user_id,
	ua.id, ua.info,
	c.type, c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload
FROM sessions s
LEFT JOIN user_agents ua ON s.project_id = ua.project_id AND s.user_agent_id = ua.id
LEFT JOIN checks c ON c.project_id = s.project_id AND c.session_id = s.id`

type sessionStatements struct{ statement }

func newSessionStatements(client queryExecutor) sessionStatements {
	return sessionStatements{statement: statement{client: client}}
}

// CreateSession implements [service.SessionStatements].
func (ss sessionStatements) CreateSession(ctx context.Context, session *domain.Session) error {
	return withTransaction(ctx, ss.client, func(ctx context.Context, tx queryExecutor) error {
		return sessionStatements{statement: statement{client: tx}}.InsertSession(ctx, session)
	})
}

// GetSessionByID implements [service.SessionStatements].
func (ss sessionStatements) GetSessionByID(ctx context.Context, projectID, sessionID string) (*domain.Session, error) {
	sessions, err := ss.querySessions(ctx, &database.ListOptions[domain.SessionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.SessionFieldProjectID), projectID),
			database.Equal(database.Col(domain.SessionFieldID), sessionID),
		),
		Pagination: database.Page[domain.SessionField]{
			OrderBy: database.OrderBy[domain.SessionField]{Columns: []database.Column[domain.SessionField]{database.Col(domain.SessionFieldID)}},
		},
	})
	if err != nil {
		return nil, err
	}
	if len(sessions) == 0 {
		return nil, domain.ErrSessionNotFound()
	}
	return sessions[0], nil
}

// ListSessions implements [service.SessionStatements].
func (ss sessionStatements) ListSessions(ctx context.Context, filter *database.ListOptions[domain.SessionField]) (*database.ListResult[*domain.Session], error) {
	if filter.Pagination.OrderBy.Columns == nil {
		filter.Pagination.OrderBy.Columns = []database.Column[domain.SessionField]{database.Col(domain.SessionFieldID)}
	}
	sessions, err := ss.querySessions(ctx, filter)
	if err != nil {
		return nil, err
	}
	if sessions == nil {
		sessions = []*domain.Session{}
	}
	var nextCursor []byte
	if filter.Pagination.Limit > 0 && len(sessions) == int(filter.Pagination.Limit) {
		cursor := &pagination.Cursor[domain.SessionField]{
			Columns: filter.Pagination.OrderBy.Columns,
			Values:  sessionSchema.ValuesFrom(sessions[len(sessions)-1], filter.Pagination.OrderBy.Columns),
		}
		nextCursor = cursor.Marshal()
	}
	return &database.ListResult[*domain.Session]{Items: sessions, NextCursor: nextCursor}, nil
}

// DeleteSessionByID implements [service.SessionStatements].
func (ss sessionStatements) DeleteSessionByID(ctx context.Context, projectID, sessionID string) error {
	n, err := execAffected(ctx, ss.client, `DELETE FROM sessions WHERE project_id = ? AND id = ?`, projectID, sessionID)
	if err != nil {
		return err
	}
	if n == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

// ExchangeSession implements [service.SessionStatements].
func (ss sessionStatements) ExchangeSession(ctx context.Context, projectID, handoffToken string, _ *string, ttl time.Duration) (*domain.Session, error) {
	var refreshed *domain.Session
	err := withTransaction(ctx, ss.client, func(ctx context.Context, tx queryExecutor) error {
		var err error
		refreshed, err = v2session.RunExchange(ctx, sessionExchangeStore{sessionStatements{statement: statement{client: tx}}}, projectID, handoffToken, ttl)
		return err
	})
	return refreshed, err
}

// sessionExchangeStore wraps sessionStatements to implement [v2session.ExchangeStore].
type sessionExchangeStore struct{ sessionStatements }

func (s sessionExchangeStore) GetAuthAttemptByHandoffToken(ctx context.Context, projectID string, handoffTokenHash []byte) (*domain.AuthAttempt, error) {
	return newAuthAttemptStatements(s.client).GetAuthAttemptByHandoffToken(ctx, projectID, handoffTokenHash)
}

func (s sessionExchangeStore) DeleteAuthAttempt(ctx context.Context, projectID, attemptID string) error {
	return newAuthAttemptStatements(s.client).DeleteAuthAttemptByID(ctx, projectID, attemptID)
}

func (ss sessionStatements) querySessions(ctx context.Context, filter *database.ListOptions[domain.SessionField]) ([]*domain.Session, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, sessionQuery, filter, sessionSchema); err != nil {
		return nil, err
	}
	rows, err := ss.client.Query(ctx, compiler.String(), compiler.args...)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	return scanSessions(rows)
}

// InsertSession inserts the user_agent (optional), session, and initial token.
func (ss sessionStatements) InsertSession(ctx context.Context, session *domain.Session) error {
	if session.TimeToLive <= 0 {
		session.TimeToLive = domain.SessionAnonymousTTL
	}
	if err := ensureManagedID(&session.ID, domain.PrefixSession); err != nil {
		return err
	}
	now := nowUnixNano()
	var userAgentID any
	if session.UserAgent != nil {
		info := session.UserAgent.Info
		if info == nil {
			info = map[string]any{}
		}
		if session.UserAgent.IP != "" {
			info["ip"] = session.UserAgent.IP
		}
		if session.UserAgent.ID != "" {
			info[v2session.UserAgentFingerprintKey] = session.UserAgent.ID
		}
		raw, err := json.Marshal(info)
		if err != nil {
			return fmt.Errorf("failed to marshal user agent info: %w", err)
		}
		uaID := ""
		if err := ensureManagedID(&uaID, domain.PrefixUserAgent); err != nil {
			return err
		}
		if _, err := ss.client.Exec(ctx,
			`INSERT INTO user_agents (project_id, id, info, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
			session.ProjectID, uaID, string(raw), now, now,
		); err != nil {
			return fmt.Errorf("failed to insert user agent: %w", wrapError(err))
		}
		userAgentID = uaID
	}

	var createdNano, updatedNano, expiresNano int64
	err := ss.client.QueryRow(ctx,
		`INSERT INTO sessions (project_id, id, user_agent_id, time_to_live, token_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING created_at, updated_at, expires_at`,
		session.ProjectID, session.ID, userAgentID, session.TimeToLive.Nanoseconds(), nil, now, now,
	).Scan(&createdNano, &updatedNano, &expiresNano)
	if err != nil {
		return fmt.Errorf("failed to insert session: %w", wrapError(err))
	}
	session.CreatedAt = timeFromUnixNano(createdNano)
	session.UpdatedAt = timeFromUnixNano(updatedNano)
	session.ExpiresAt = timeFromUnixNano(expiresNano)
	return ss.CreateSessionToken(ctx, session, "")
}

// CreateSessionToken creates a session token and links it back to the session.
func (ss sessionStatements) CreateSessionToken(ctx context.Context, session *domain.Session, previousTokenID string) error {
	if session.ID == "" {
		return fmt.Errorf("session id is required")
	}
	expiresAt := session.ExpiresAt
	tok := &domain.Token{
		ProjectID: session.ProjectID,
		Type:      domain.TokenTypeSessionToken,
		SessionID: &session.ID,
		ExpiresAt: &expiresAt,
		Scope:     []string{},
	}
	if session.UserID != nil {
		tok.UserID = *session.UserID
	}
	tokens := newTokenStatements(ss.client)
	if err := tokens.CreateToken(ctx, tok); err != nil {
		return fmt.Errorf("failed to create session token: %w", err)
	}
	if _, err := ss.client.Exec(ctx,
		`UPDATE sessions SET token_id = ? WHERE project_id = ? AND id = ?`,
		tok.TokenID, session.ProjectID, session.ID,
	); err != nil {
		return fmt.Errorf("failed to set session token_id: %w", wrapError(err))
	}
	session.TokenID = tok.TokenID
	if v2session.HasRealSessionToken(previousTokenID) {
		if err := tokens.RevokeTokenByID(ctx, session.ProjectID, previousTokenID); err != nil {
			return fmt.Errorf("failed to revoke previous session token: %w", err)
		}
	}
	return nil
}

// UpdateSessionAfterExchange updates user_id and/or time_to_live on a session.
func (ss sessionStatements) UpdateSessionAfterExchange(ctx context.Context, projectID, sessionID string, userID *string, ttl time.Duration) error {
	var c statementCompiler
	c.WriteString(`UPDATE sessions SET updated_at = `)
	c.WriteArg(nowUnixNano())
	if userID != nil {
		c.WriteString(", user_id = ")
		c.WriteArg(*userID)
	}
	if ttl > 0 {
		c.WriteString(", time_to_live = ")
		c.WriteArg(ttl.Nanoseconds())
	}
	c.WriteString(" WHERE project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND id = ")
	c.WriteArg(sessionID)
	n, err := execAffected(ctx, ss.client, c.String(), c.args...)
	if err != nil {
		return err
	}
	if n == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

// ApplyExchange promotes attempt checks onto the session and prunes duplicates.
func (ss sessionStatements) ApplyExchange(ctx context.Context, projectID, sessionID string, last map[domain.AuthCheckType]v2session.StoredCheck) error {
	for _, c := range last {
		if !c.OnAttempt {
			continue
		}
		n, err := execAffected(ctx, ss.client,
			`UPDATE checks SET session_id = ?, auth_attempt_id = NULL, challenge_payload = NULL, last_challenged_at = NULL, last_failed_at = NULL, failure_count = 0 WHERE project_id = ? AND id = ? AND auth_attempt_id IS NOT NULL`,
			sessionID, projectID, c.ID)
		if err != nil {
			return err
		}
		if n == 0 {
			return fmt.Errorf("failed to promote check %s", c.ID)
		}
	}
	for _, c := range last {
		if _, err := ss.client.Exec(ctx,
			`DELETE FROM checks WHERE project_id = ? AND session_id = ? AND type = ? AND id != ?`,
			projectID, sessionID, int64(c.Type), c.ID,
		); err != nil {
			return wrapError(err)
		}
	}
	return nil
}

// UserIDFromLastVerifiedChecks reads the user factor payload from the check row.
func (ss sessionStatements) UserIDFromLastVerifiedChecks(ctx context.Context, projectID string, last map[domain.AuthCheckType]v2session.StoredCheck) (*string, error) {
	w, ok := last[domain.AuthCheckTypeUser]
	if !ok {
		return nil, nil
	}
	var factorPayload sql.NullString
	err := ss.client.QueryRow(ctx,
		`SELECT factor_payload FROM checks WHERE project_id = ? AND id = ?`,
		projectID, w.ID,
	).Scan(&factorPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to load user factor payload: %w", wrapError(err))
	}
	var payload domain.AuthFactorUser
	if factorPayload.Valid && factorPayload.String != "" {
		if err := json.Unmarshal([]byte(factorPayload.String), &payload); err != nil {
			return nil, err
		}
	}
	if payload.UserID == "" {
		return nil, nil
	}
	return &payload.UserID, nil
}

// LoadVerifiedChecks loads the verified checks for either a session or an auth attempt.
func (ss sessionStatements) LoadVerifiedChecks(ctx context.Context, projectID, id string, onAttempt bool) ([]v2session.StoredCheck, error) {
	query := `SELECT id, type, last_verified_at FROM checks WHERE project_id = ? AND session_id = ? AND last_verified_at IS NOT NULL`
	if onAttempt {
		query = `SELECT id, type, last_verified_at FROM checks WHERE project_id = ? AND auth_attempt_id = ? AND last_verified_at IS NOT NULL`
	}
	rows, err := ss.client.Query(ctx, query, projectID, id)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	var out []v2session.StoredCheck
	for rows.Next() {
		var (
			cid          string
			typ          int64
			verifiedNano int64
		)
		if err := rows.Scan(&cid, &typ, &verifiedNano); err != nil {
			return nil, err
		}
		out = append(out, v2session.StoredCheck{
			ID:             cid,
			Type:           domain.AuthCheckType(typ),
			LastVerifiedAt: timeFromUnixNano(verifiedNano),
			OnAttempt:      onAttempt,
		})
	}
	return out, rows.Err()
}

func scanSessions(rows *sql.Rows) ([]*domain.Session, error) {
	byID := map[string]*domain.Session{}
	order := []string{}
	for rows.Next() {
		var (
			projectID                                            string
			sessionID                                            string
			tokenID                                              sql.NullString
			createdNano, updatedNano, expiresNano                int64
			timeToLiveNanos                                      int64
			userID                                               sql.NullString
			userAgentID                                          sql.NullString
			userAgentInfo                                        sql.NullString
			checkType, failureCount                              sql.NullInt64
			checkID                                              sql.NullString
			lastChallengedNano, lastVerifiedNano, lastFailedNano sql.NullInt64
			challengePayload, factorPayload                      sql.NullString
		)
		if err := rows.Scan(
			&projectID, &sessionID, &createdNano, &updatedNano, &expiresNano, &timeToLiveNanos, &tokenID, &userID,
			&userAgentID, &userAgentInfo,
			&checkType, &checkID, &lastChallengedNano, &lastVerifiedNano, &lastFailedNano, &failureCount,
			&challengePayload, &factorPayload,
		); err != nil {
			return nil, fmt.Errorf("failed to scan session row: %w", err)
		}
		session, ok := byID[sessionID]
		if !ok {
			tok := ""
			if tokenID.Valid {
				tok = tokenID.String
			}
			session = &domain.Session{
				ProjectID:  projectID,
				ID:         sessionID,
				CreatedAt:  timeFromUnixNano(createdNano),
				UpdatedAt:  timeFromUnixNano(updatedNano),
				ExpiresAt:  timeFromUnixNano(expiresNano),
				TimeToLive: time.Duration(timeToLiveNanos),
				TokenID:    tok,
			}
			if userID.Valid {
				v := userID.String
				session.UserID = &v
			}
			if userAgentID.Valid {
				info := map[string]any{}
				if userAgentInfo.Valid && userAgentInfo.String != "" {
					if err := json.Unmarshal([]byte(userAgentInfo.String), &info); err != nil {
						return nil, err
					}
				}
				session.UserAgent = v2session.UserAgentFromStoredInfo(info)
			}
			byID[sessionID] = session
			order = append(order, sessionID)
		}
		if !checkType.Valid || !checkID.Valid || checkID.String == "" {
			continue
		}
		var (
			lastChallengedAt time.Time
			lastFailedAt     time.Time
			verifiedAt       time.Time
			fc               uint16
		)
		if lastChallengedNano.Valid {
			lastChallengedAt = timeFromUnixNano(lastChallengedNano.Int64)
		}
		if lastFailedNano.Valid {
			lastFailedAt = timeFromUnixNano(lastFailedNano.Int64)
		}
		if lastVerifiedNano.Valid {
			verifiedAt = timeFromUnixNano(lastVerifiedNano.Int64)
		}
		if failureCount.Valid {
			fc = uint16(failureCount.Int64)
		}
		checks, err := v2session.DecodeAuthChecks(
			domain.AuthCheckType(checkType.Int64),
			checkID.String,
			lastChallengedAt, lastFailedAt, verifiedAt, fc,
			nullJSONBytes(challengePayload),
			nullJSONBytes(factorPayload),
		)
		if err != nil {
			return nil, err
		}
		for _, check := range checks {
			if f, ok := check.(domain.AuthFactor); ok {
				v2session.AppendFactor(session, f)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, wrapError(err)
	}
	out := make([]*domain.Session, 0, len(order))
	for _, id := range order {
		out = append(out, byID[id])
	}
	return out, nil
}

func coerceSessionDuration(v any) (any, error) {
	switch d := v.(type) {
	case time.Duration:
		return d.Nanoseconds(), nil
	case float64:
		return int64(d), nil
	case int64:
		return d, nil
	case string:
		parsed, err := time.ParseDuration(d)
		if err != nil {
			return nil, database.ErrCoerceExpectedType("duration", v)
		}
		return parsed.Nanoseconds(), nil
	default:
		return nil, database.ErrCoerceExpectedType("duration", v)
	}
}

var _ service.SessionStatements = (*sessionStatements)(nil)
var _ v2session.ExchangeStore = sessionExchangeStore{}

var sessionSchema = database.NewSchema(map[domain.SessionField]database.FieldBinding[domain.Session]{
	domain.SessionFieldProjectID: {SQLName: "s.project_id", Accessor: func(s *domain.Session) any { return s.ProjectID }, Coerce: database.CoerceString},
	domain.SessionFieldID:        {SQLName: "s.id", Accessor: func(s *domain.Session) any { return s.ID }, Coerce: database.CoerceString},
	domain.SessionFieldCreatedAt: {SQLName: "s.created_at", Accessor: func(s *domain.Session) any { return s.CreatedAt }, Coerce: database.CoerceTime},
	domain.SessionFieldUpdatedAt: {SQLName: "s.updated_at", Accessor: func(s *domain.Session) any { return s.UpdatedAt }, Coerce: database.CoerceTime},
	domain.SessionFieldExpiresAt: {SQLName: "s.expires_at", Accessor: func(s *domain.Session) any { return s.ExpiresAt }, Coerce: database.CoerceTime},
	domain.SessionFieldTimeToLive: {
		SQLName:  "s.time_to_live",
		Accessor: func(s *domain.Session) any { return s.TimeToLive.Nanoseconds() },
		Coerce:   coerceSessionDuration,
	},
	domain.SessionFieldTokenID: {SQLName: "s.token_id", Accessor: func(s *domain.Session) any { return s.TokenID }, Coerce: database.CoerceString},
	domain.SessionFieldUserID: {
		SQLName: "s.user_id",
		Accessor: func(s *domain.Session) any {
			if s.UserID == nil {
				return ""
			}
			return *s.UserID
		},
		Coerce: database.CoerceString,
	},
})
