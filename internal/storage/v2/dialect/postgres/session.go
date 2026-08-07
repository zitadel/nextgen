package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	v2session "github.com/zitadel/nextgen/internal/storage/v2/session"
)

const (
	insertUserAgentStmt = `INSERT INTO zitadel_nextgen.user_agents (project_id, id, info) VALUES ($1, $2, $3)`
	insertSessionStmt   = `INSERT INTO zitadel_nextgen.sessions (project_id, id, user_agent_id, time_to_live, token_id)
VALUES ($1, $2, $3, $4::INTERVAL, $5) RETURNING created_at, updated_at, expires_at`
	updateSessionTokenIDStmt = `UPDATE zitadel_nextgen.sessions SET token_id = $3 WHERE project_id = $1 AND id = $2`
	deleteSessionByIDStmt    = `DELETE FROM zitadel_nextgen.sessions WHERE project_id = $1 AND id = $2`
	sessionQuery             = `SELECT s.project_id, s.id, s.created_at, s.updated_at, s.expires_at, s.time_to_live, s.token_id, s.user_id,
	ua.id, ua.info,
	c.type, c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload
FROM zitadel_nextgen.sessions s
LEFT JOIN zitadel_nextgen.user_agents ua ON s.project_id = ua.project_id AND s.user_agent_id = ua.id
LEFT JOIN zitadel_nextgen.checks c ON c.project_id = s.project_id AND c.session_id = s.id`
	loadAttemptChecksStmt       = `SELECT id, type, last_verified_at FROM zitadel_nextgen.checks WHERE project_id = $1 AND auth_attempt_id = $2 AND last_verified_at IS NOT NULL`
	loadSessionChecksStmt       = `SELECT id, type, last_verified_at FROM zitadel_nextgen.checks WHERE project_id = $1 AND session_id = $2 AND last_verified_at IS NOT NULL`
	selectFactorPayloadStmt     = `SELECT factor_payload FROM zitadel_nextgen.checks WHERE project_id = $1 AND id = $2`
	promoteCheckStmt            = `UPDATE zitadel_nextgen.checks SET session_id = $1, auth_attempt_id = NULL, challenge_payload = NULL, last_challenged_at = NULL, last_failed_at = NULL, failure_count = 0 WHERE project_id = $2 AND id = $3 AND auth_attempt_id IS NOT NULL`
	deleteSessionCheckLoserStmt = `DELETE FROM zitadel_nextgen.checks WHERE project_id = $1 AND session_id = $2 AND type = $3 AND id <> $4`
)

type sessionStatements struct{ statement }

func newSessionStatements(client queryExecutor) sessionStatements {
	return sessionStatements{statement: statement{client: client}}
}

func (ss sessionStatements) CreateSession(ctx context.Context, session *domain.Session) error {
	return withTransaction(ctx, ss.client, func(ctx context.Context, tx queryExecutor) error {
		return sessionStatements{statement: statement{client: tx}}.InsertSession(ctx, session)
	})
}

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

func (ss sessionStatements) DeleteSessionByID(ctx context.Context, projectID, sessionID string) error {
	tag, err := ss.client.Exec(ctx, deleteSessionByIDStmt, projectID, sessionID)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

func (ss sessionStatements) ExchangeSession(ctx context.Context, projectID, handoffToken string, _ *string, ttl time.Duration) (*domain.Session, error) {
	var refreshed *domain.Session
	err := withTransaction(ctx, ss.client, func(ctx context.Context, tx queryExecutor) error {
		var err error
		refreshed, err = v2session.RunExchange(ctx, sessionExchangeStore{sessionStatements{statement: statement{client: tx}}}, projectID, handoffToken, ttl)
		return err
	})
	return refreshed, err
}

// sessionExchangeStore embeds sessionStatements for [v2session.ExchangeStore]
// methods. Auth-attempt get/delete are overridden so they are not promoted from
// both sessionStatements and authAttemptStatements onto [statements].
type sessionExchangeStore struct{ sessionStatements }

func (s sessionExchangeStore) GetAuthAttemptByHandoffToken(ctx context.Context, projectID string, handoffTokenHash []byte) (*domain.AuthAttempt, error) {
	return newAuthAttemptStatements(s.client).GetAuthAttemptByHandoffToken(ctx, projectID, handoffTokenHash)
}

func (s sessionExchangeStore) DeleteAuthAttempt(ctx context.Context, projectID, attemptID string) error {
	return newAuthAttemptStatements(s.client).DeleteAuthAttemptByID(ctx, projectID, attemptID)
}

func (ss sessionStatements) LoadVerifiedChecks(ctx context.Context, projectID, id string, onAttempt bool) ([]v2session.StoredCheck, error) {
	query := loadSessionChecksStmt
	if onAttempt {
		query = loadAttemptChecksStmt
	}
	return ss.loadStoredChecks(ctx, query, projectID, id, onAttempt)
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
	sessions, err := scanSessions(rows)
	if err != nil {
		return nil, wrapError(err)
	}
	return sessions, nil
}

func (ss sessionStatements) InsertSession(ctx context.Context, session *domain.Session) error {
	if session.TimeToLive <= 0 {
		session.TimeToLive = domain.SessionAnonymousTTL
	}
	if err := ensureManagedID(&session.ID, domain.PrefixSession); err != nil {
		return err
	}
	var userAgentID *string
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
		if _, err := ss.client.Exec(ctx, insertUserAgentStmt, session.ProjectID, uaID, raw); err != nil {
			return fmt.Errorf("failed to insert user agent: %w", wrapError(err))
		}
		userAgentID = &uaID
	}
	err := ss.client.QueryRow(ctx, insertSessionStmt, session.ProjectID, session.ID, userAgentID, session.TimeToLive, nil).
		Scan(&session.CreatedAt, &session.UpdatedAt, &session.ExpiresAt)
	if err != nil {
		return fmt.Errorf("failed to insert session: %w", wrapError(err))
	}
	return ss.CreateSessionToken(ctx, session, "")
}

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
	if _, err := ss.client.Exec(ctx, updateSessionTokenIDStmt, session.ProjectID, session.ID, tok.TokenID); err != nil {
		return fmt.Errorf("failed to set session token_id: %w", wrapError(err))
	}
	session.TokenID = tok.TokenID
	if v2session.HasRealSessionToken(previousTokenID) {
		if err := tokens.DeleteTokenByID(ctx, session.ProjectID, previousTokenID); err != nil {
			return fmt.Errorf("failed to revoke previous session token: %w", err)
		}
	}
	return nil
}

func (ss sessionStatements) UpdateSessionAfterExchange(ctx context.Context, projectID, sessionID string, userID *string, ttl time.Duration) error {
	var c statementCompiler
	c.WriteString(`UPDATE zitadel_nextgen.sessions SET updated_at = NOW()`)
	if userID != nil {
		c.WriteString(", user_id = ")
		c.WriteArg(*userID)
	}
	if ttl > 0 {
		c.WriteString(", time_to_live = ")
		c.WriteArg(ttl)
		c.WriteString("::INTERVAL")
	}
	c.WriteString(" WHERE project_id = ")
	c.WriteArg(projectID)
	c.WriteString(" AND id = ")
	c.WriteArg(sessionID)
	tag, err := ss.client.Exec(ctx, c.String(), c.args...)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

func (ss sessionStatements) ApplyExchange(ctx context.Context, projectID, sessionID string, lastVerifiedChecks map[domain.AuthCheckType]v2session.StoredCheck) error {
	for _, c := range lastVerifiedChecks {
		if !c.OnAttempt {
			continue
		}
		tag, err := ss.client.Exec(ctx, promoteCheckStmt, sessionID, projectID, c.ID)
		if err != nil {
			return wrapError(err)
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("failed to promote check %s", c.ID)
		}
	}
	for _, c := range lastVerifiedChecks {
		if _, err := ss.client.Exec(ctx, deleteSessionCheckLoserStmt, projectID, sessionID, c.Type, c.ID); err != nil {
			return wrapError(err)
		}
	}
	return nil
}

func (ss sessionStatements) UserIDFromLastVerifiedChecks(ctx context.Context, projectID string, lastVerifiedChecks map[domain.AuthCheckType]v2session.StoredCheck) (*string, error) {
	w, ok := lastVerifiedChecks[domain.AuthCheckTypeUser]
	if !ok {
		return nil, nil
	}
	var factor []byte
	if err := ss.client.QueryRow(ctx, selectFactorPayloadStmt, projectID, w.ID).Scan(&factor); err != nil {
		return nil, fmt.Errorf("failed to load user factor payload: %w", wrapError(err))
	}
	var payload domain.AuthFactorUser
	if len(factor) > 0 {
		if err := json.Unmarshal(factor, &payload); err != nil {
			return nil, fmt.Errorf("failed to unmarshal user factor payload: %w", err)
		}
	}
	if payload.UserID == "" {
		return nil, nil
	}
	return &payload.UserID, nil
}

func (ss sessionStatements) loadStoredChecks(ctx context.Context, query, projectID, id string, onAttempt bool) ([]v2session.StoredCheck, error) {
	rows, err := ss.client.Query(ctx, query, projectID, id)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	var out []v2session.StoredCheck
	for rows.Next() {
		var checkID string
		var typ int64
		var lastVerifiedAt time.Time
		if err := rows.Scan(&checkID, &typ, &lastVerifiedAt); err != nil {
			return nil, err
		}
		out = append(out, v2session.StoredCheck{ID: checkID, Type: domain.AuthCheckType(typ), LastVerifiedAt: lastVerifiedAt, OnAttempt: onAttempt})
	}
	return out, rows.Err()
}

func scanSessions(rows pgx.Rows) ([]*domain.Session, error) {
	byID := map[string]*domain.Session{}
	order := []string{}
	for rows.Next() {
		var (
			projectID                                      string
			sessionID                                      string
			tokenID                                        *string
			checkID                                        *string
			createdAt, updatedAt, expiresAt                time.Time
			timeToLive                                     time.Duration
			userID                                         *string
			userAgentID                                    *string
			userAgentInfo                                  []byte
			checkType                                      *int64
			lastChallengedAt, lastVerifiedAt, lastFailedAt *time.Time
			failureCount                                   *uint16
			challenge, factor                              []byte
		)
		if err := rows.Scan(&projectID, &sessionID, &createdAt, &updatedAt, &expiresAt, &timeToLive, &tokenID, &userID,
			&userAgentID, &userAgentInfo, &checkType, &checkID, &lastChallengedAt, &lastVerifiedAt, &lastFailedAt, &failureCount, &challenge, &factor); err != nil {
			return nil, fmt.Errorf("failed to scan session row: %w", err)
		}
		id := sessionID
		session, ok := byID[id]
		if !ok {
			tok := ""
			if tokenID != nil {
				tok = *tokenID
			}
			session = &domain.Session{ProjectID: projectID, ID: id, CreatedAt: createdAt, UpdatedAt: updatedAt, ExpiresAt: expiresAt, TimeToLive: timeToLive, TokenID: tok, UserID: userID}
			if userAgentID != nil {
				info := map[string]any{}
				if len(userAgentInfo) > 0 {
					if err := json.Unmarshal(userAgentInfo, &info); err != nil {
						return nil, fmt.Errorf("failed to unmarshal user agent info: %w", err)
					}
				}
				session.UserAgent = v2session.UserAgentFromStoredInfo(info)
			}
			byID[id] = session
			order = append(order, id)
		}
		if checkType == nil || checkID == nil || *checkID == "" {
			continue
		}
		var challengedAt, failedAt, verifiedAt time.Time
		var failures uint16
		if lastChallengedAt != nil {
			challengedAt = *lastChallengedAt
		}
		if lastFailedAt != nil {
			failedAt = *lastFailedAt
		}
		if lastVerifiedAt != nil {
			verifiedAt = *lastVerifiedAt
		}
		if failureCount != nil {
			failures = *failureCount
		}
		checks, err := v2session.DecodeAuthChecks(domain.AuthCheckType(*checkType), *checkID, challengedAt, failedAt, verifiedAt, failures, challenge, factor)
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
		return nil, err
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
		return d, nil
	case float64:
		return time.Duration(d), nil
	case int64:
		return time.Duration(d), nil
	case string:
		parsed, err := time.ParseDuration(d)
		if err != nil {
			return nil, database.ErrCoerceExpectedType("duration", v)
		}
		return parsed, nil
	default:
		return nil, database.ErrCoerceExpectedType("duration", v)
	}
}

var _ service.SessionStatements = (*sessionStatements)(nil)
var _ v2session.ExchangeStore = sessionExchangeStore{}

var sessionSchema = database.NewSchema(map[domain.SessionField]database.FieldBinding[domain.Session]{
	domain.SessionFieldProjectID:  {SQLName: "s.project_id", Accessor: func(s *domain.Session) any { return s.ProjectID }, Coerce: database.CoerceString},
	domain.SessionFieldID:         {SQLName: "s.id", Accessor: func(s *domain.Session) any { return s.ID }, Coerce: database.CoerceString},
	domain.SessionFieldCreatedAt:  {SQLName: "s.created_at", Accessor: func(s *domain.Session) any { return s.CreatedAt }, Coerce: database.CoerceTime},
	domain.SessionFieldUpdatedAt:  {SQLName: "s.updated_at", Accessor: func(s *domain.Session) any { return s.UpdatedAt }, Coerce: database.CoerceTime},
	domain.SessionFieldExpiresAt:  {SQLName: "s.expires_at", Accessor: func(s *domain.Session) any { return s.ExpiresAt }, Coerce: database.CoerceTime},
	domain.SessionFieldTimeToLive: {SQLName: "s.time_to_live", Accessor: func(s *domain.Session) any { return s.TimeToLive }, Coerce: coerceSessionDuration},
	// token_id is NULL until the session token is created; "" is never stored.
	domain.SessionFieldTokenID: {SQLName: "s.token_id", Accessor: func(s *domain.Session) any {
		if s.TokenID == "" {
			return nil
		}
		return s.TokenID
	}, Coerce: database.CoerceString, Nullable: true},
	domain.SessionFieldUserID: {SQLName: "s.user_id", Accessor: func(s *domain.Session) any { return database.NullableValue(s.UserID) }, Coerce: database.CoerceString, Nullable: true},
})
