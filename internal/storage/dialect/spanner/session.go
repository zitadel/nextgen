package spanner

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	v2session "github.com/zitadel/nextgen/internal/storage/session"
)

type sessionStatements struct{ statement }

func newSessionStatements(db queryExecutor) sessionStatements {
	return sessionStatements{statement: statement{db: db}}
}

func (ss sessionStatements) CreateSession(ctx context.Context, session *domain.Session) error {
	return withTransaction(ctx, ss.db, func(ctx context.Context, tx queryExecutor) error {
		return sessionStatements{statement: statement{db: tx}}.InsertSession(ctx, session)
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
	nextCursor := pagination.MarshalNext(
		filter.Pagination.OrderBy,
		sessions,
		sessionSchema,
		filter.Pagination.Limit,
	)
	return &database.ListResult[*domain.Session]{Items: sessions, NextCursor: nextCursor}, nil
}

func (ss sessionStatements) DeleteSessionByID(ctx context.Context, projectID, sessionID string) error {
	return withTransaction(ctx, ss.db, func(ctx context.Context, tx queryExecutor) error {
		n, err := tx.Update(ctx, buildStatement(`DELETE FROM sessions WHERE project_id = @p1 AND id = @p2`, projectID, sessionID).statement())
		if err != nil {
			return err
		}
		if n == 0 {
			return domain.ErrSessionNotFound()
		}
		rsi := newResourceScopeStatements(tx)
		return rsi.DeleteResourceScope(ctx, domain.ResourceKindSession, projectID, sessionID)
	})
}

func (ss sessionStatements) ExchangeSession(ctx context.Context, projectID, handoffToken string, _ *string, ttl time.Duration) (*domain.Session, error) {
	var refreshed *domain.Session
	err := withTransaction(ctx, ss.db, func(ctx context.Context, tx queryExecutor) error {
		var err error
		refreshed, err = v2session.RunExchange(ctx, sessionExchangeStore{sessionStatements{statement: statement{db: tx}}}, projectID, handoffToken, ttl)
		return err
	})
	return refreshed, err
}

// sessionExchangeStore embeds sessionStatements for [v2session.ExchangeStore]
// methods. Auth-attempt get/delete are overridden so they are not promoted from
// both sessionStatements and authAttemptStatements onto [statements].
type sessionExchangeStore struct{ sessionStatements }

func (s sessionExchangeStore) GetAuthAttemptByHandoffToken(ctx context.Context, projectID string, handoffTokenHash []byte) (*domain.AuthAttempt, error) {
	return newAuthAttemptStatements(s.db).GetAuthAttemptByHandoffToken(ctx, projectID, handoffTokenHash)
}

func (s sessionExchangeStore) DeleteAuthAttempt(ctx context.Context, projectID, attemptID string) error {
	return newAuthAttemptStatements(s.db).DeleteAuthAttemptByID(ctx, projectID, attemptID)
}

const (
	// The inner subquery filters, orders and limits the sessions; user agents
	// and checks are then joined onto that page. Limiting after the
	// one-to-many checks join would bound joined rows, not sessions.
	sessionQuerySelect = `SELECT s.project_id, s.id, s.created_at, s.updated_at, s.expires_at, s.time_to_live, s.token_id, s.user_id,
	ua.id, ua.info,
	c.type, c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload
FROM (`
	sessionQueryInner = `SELECT s.* FROM sessions s`
	sessionQueryJoins = `) s
LEFT JOIN user_agents ua ON s.project_id = ua.project_id AND s.user_agent_id = ua.id
LEFT JOIN checks c ON c.project_id = s.project_id AND c.session_id = s.id`
)

func (ss sessionStatements) querySessions(ctx context.Context, filter *database.ListOptions[domain.SessionField]) ([]*domain.Session, error) {
	var compiler statementCompiler
	compiler.WriteString(sessionQuerySelect)
	if err := compileRead(&compiler, sessionQueryInner, filter, sessionSchema); err != nil {
		return nil, err
	}
	compiler.WriteString(sessionQueryJoins)
	// The joins do not preserve the subquery's order.
	compileOrderBy(&compiler, filter.Pagination.OrderBy, sessionSchema)
	var sessions []*domain.Session
	err := ss.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		sessions, err = scanSessions(iter)
		return err
	})
	return sessions, err
}

func (ss sessionStatements) InsertSession(ctx context.Context, session *domain.Session) error {
	if session.TimeToLive <= 0 {
		session.TimeToLive = domain.SessionAnonymousTTL
	}
	if err := ensureManagedID(&session.ID, domain.PrefixSession); err != nil {
		return err
	}
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
		stmt := buildStatement(`INSERT INTO user_agents (project_id, id, info) VALUES (@p1, @p2, @p3)`, session.ProjectID, uaID, encodeSpannerJSON(raw)).statement()
		if _, err := ss.db.Update(ctx, stmt); err != nil {
			return fmt.Errorf("failed to insert user agent: %w", err)
		}
		userAgentID = uaID
	}
	stmt := buildStatement(`INSERT INTO sessions (project_id, id, user_agent_id, time_to_live, token_id, created_at, updated_at) VALUES (@p1, @p2, @p3, @p4, @p5, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()) THEN RETURN created_at, updated_at, expires_at`,
		session.ProjectID, session.ID, userAgentID, session.TimeToLive.Nanoseconds(), nil).statement()
	err := ss.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&session.CreatedAt, &session.UpdatedAt, &session.ExpiresAt)
		})
		return err
	})
	if err != nil {
		return fmt.Errorf("failed to insert session: %w", err)
	}
	if err := ss.CreateSessionToken(ctx, session, ""); err != nil {
		return err
	}
	rsi := newResourceScopeStatements(ss.db)
	return rsi.UpsertResourceScope(ctx, domain.NewResourceScope(domain.ResourceKindSession, session.ProjectID, session.ID))
}

func (ss sessionStatements) CreateSessionToken(ctx context.Context, session *domain.Session, previousTokenID string) error {
	if session.ID == "" {
		return fmt.Errorf("session id is required")
	}
	expiresAt := session.ExpiresAt
	tok := &domain.Token{ProjectID: session.ProjectID, Type: domain.TokenTypeSessionToken, SessionID: &session.ID, ExpiresAt: &expiresAt, Scope: []string{}}
	if session.UserID != nil {
		tok.UserID = *session.UserID
	}
	tokens := newTokenStatements(ss.db)
	if err := tokens.CreateToken(ctx, tok); err != nil {
		return fmt.Errorf("failed to create session token: %w", err)
	}
	if _, err := ss.db.Update(ctx, buildStatement(`UPDATE sessions SET token_id = @p3 WHERE project_id = @p1 AND id = @p2`, session.ProjectID, session.ID, tok.TokenID).statement()); err != nil {
		return fmt.Errorf("failed to set session token_id: %w", err)
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
	c.WriteString(`UPDATE sessions SET updated_at = CURRENT_TIMESTAMP()`)
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
	n, err := ss.db.Update(ctx, c.statement())
	if err != nil {
		return err
	}
	if n == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

func (ss sessionStatements) ApplyExchange(ctx context.Context, projectID, sessionID string, last map[domain.AuthCheckType]v2session.StoredCheck) error {
	for _, c := range last {
		if !c.OnAttempt {
			continue
		}
		n, err := ss.db.Update(ctx, buildStatement(`UPDATE checks SET session_id = @p1, auth_attempt_id = NULL, challenge_payload = NULL, last_challenged_at = NULL, last_failed_at = NULL, failure_count = 0 WHERE project_id = @p2 AND id = @p3 AND auth_attempt_id IS NOT NULL`, sessionID, projectID, c.ID).statement())
		if err != nil {
			return err
		}
		if n == 0 {
			return fmt.Errorf("failed to promote check %s", c.ID)
		}
	}
	for _, c := range last {
		if _, err := ss.db.Update(ctx, buildStatement(`DELETE FROM checks WHERE project_id = @p1 AND session_id = @p2 AND type = @p3 AND id <> @p4`, projectID, sessionID, int64(c.Type), c.ID).statement()); err != nil {
			return err
		}
	}
	return nil
}

func (ss sessionStatements) UserIDFromLastVerifiedChecks(ctx context.Context, projectID string, last map[domain.AuthCheckType]v2session.StoredCheck) (*string, error) {
	w, ok := last[domain.AuthCheckTypeUser]
	if !ok {
		return nil, nil
	}
	var factor spanner.NullJSON
	err := ss.db.Query(ctx, buildStatement(`SELECT factor_payload FROM checks WHERE project_id = @p1 AND id = @p2`, projectID, w.ID).statement(), func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			return struct{}{}, row.Columns(&factor)
		})
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("failed to load user factor payload: %w", err)
	}
	var payload domain.AuthFactorUser
	if factor.Valid {
		raw, err := json.Marshal(factor.Value)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &payload); err != nil {
			return nil, err
		}
	}
	if payload.UserID == "" {
		return nil, nil
	}
	return &payload.UserID, nil
}

func (ss sessionStatements) LoadVerifiedChecks(ctx context.Context, projectID, id string, onAttempt bool) ([]v2session.StoredCheck, error) {
	query := `SELECT id, type, last_verified_at FROM checks WHERE project_id = @p1 AND session_id = @p2 AND last_verified_at IS NOT NULL`
	if onAttempt {
		query = `SELECT id, type, last_verified_at FROM checks WHERE project_id = @p1 AND auth_attempt_id = @p2 AND last_verified_at IS NOT NULL`
	}
	var out []v2session.StoredCheck
	err := ss.db.Query(ctx, buildStatement(query, projectID, id).statement(), func(iter *spanner.RowIterator) error {
		return iter.Do(func(row *spanner.Row) error {
			var cid string
			var typ int64
			var at time.Time
			if err := row.Columns(&cid, &typ, &at); err != nil {
				return err
			}
			out = append(out, v2session.StoredCheck{ID: cid, Type: domain.AuthCheckType(typ), LastVerifiedAt: at, OnAttempt: onAttempt})
			return nil
		})
	})
	return out, err
}

func scanSessions(iter *spanner.RowIterator) ([]*domain.Session, error) {
	byID := map[string]*domain.Session{}
	order := []string{}
	err := iter.Do(func(row *spanner.Row) error {
		var (
			projectID                                      string
			sessionID                                      string
			tokenID                                        spanner.NullString
			createdAt, updatedAt, expiresAt                time.Time
			timeToLiveNanos                                int64
			userID                                         spanner.NullString
			userAgentID, checkID                           spanner.NullString
			checkType, failureCount                        spanner.NullInt64
			userAgentInfo, challenge, factor               spanner.NullJSON
			lastChallengedAt, lastVerifiedAt, lastFailedAt spanner.NullTime
		)
		if err := row.Columns(&projectID, &sessionID, &createdAt, &updatedAt, &expiresAt, &timeToLiveNanos, &tokenID, &userID,
			&userAgentID, &userAgentInfo, &checkType, &checkID, &lastChallengedAt, &lastVerifiedAt, &lastFailedAt, &failureCount, &challenge, &factor); err != nil {
			return fmt.Errorf("failed to scan session row: %w", err)
		}
		id := sessionID
		session, ok := byID[id]
		if !ok {
			tok := ""
			if tokenID.Valid {
				tok = tokenID.StringVal
			}
			session = &domain.Session{ProjectID: projectID, ID: id, CreatedAt: createdAt, UpdatedAt: updatedAt, ExpiresAt: expiresAt, TimeToLive: time.Duration(timeToLiveNanos), TokenID: tok}
			if userID.Valid {
				session.UserID = &userID.StringVal
			}
			if userAgentID.Valid {
				info := map[string]any{}
				if userAgentInfo.Valid {
					raw, err := json.Marshal(userAgentInfo.Value)
					if err != nil {
						return err
					}
					if err := json.Unmarshal(raw, &info); err != nil {
						return err
					}
				}
				session.UserAgent = v2session.UserAgentFromStoredInfo(info)
			}
			byID[id] = session
			order = append(order, id)
		}
		if !checkType.Valid || !checkID.Valid {
			return nil
		}
		checks, err := v2session.DecodeAuthChecks(domain.AuthCheckType(checkType.Int64), checkID.StringVal, nullTime(lastChallengedAt), nullTime(lastFailedAt), nullTime(lastVerifiedAt), uint16(failureCount.Int64), nullJSONBytes(challenge), nullJSONBytes(factor))
		if err != nil {
			return err
		}
		for _, check := range checks {
			if f, ok := check.(domain.AuthFactor); ok {
				v2session.AppendFactor(session, f)
			}
		}
		return nil
	})
	if err != nil {
		return nil, wrapError(err)
	}
	out := make([]*domain.Session, 0, len(order))
	for _, id := range order {
		out = append(out, byID[id])
	}
	return out, nil
}

func nullTime(t spanner.NullTime) time.Time {
	if t.Valid {
		return t.Time
	}
	return time.Time{}
}
func nullJSONBytes(j spanner.NullJSON) []byte {
	if !j.Valid {
		return nil
	}
	b, err := json.Marshal(j.Value)
	if err != nil {
		return nil
	}
	return b
}
func encodeSpannerJSON(b []byte) any {
	if len(b) == 0 {
		return spanner.NullJSON{Valid: false}
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return spanner.NullJSON{Value: string(b), Valid: true}
	}
	return spanner.NullJSON{Value: v, Valid: true}
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
	domain.SessionFieldProjectID:  {SQLName: "s.project_id", Accessor: func(s *domain.Session) any { return s.ProjectID }, Coerce: database.CoerceString},
	domain.SessionFieldID:         {SQLName: "s.id", Accessor: func(s *domain.Session) any { return s.ID }, Coerce: database.CoerceString},
	domain.SessionFieldCreatedAt:  {SQLName: "s.created_at", Accessor: func(s *domain.Session) any { return s.CreatedAt }, Coerce: database.CoerceTime},
	domain.SessionFieldUpdatedAt:  {SQLName: "s.updated_at", Accessor: func(s *domain.Session) any { return s.UpdatedAt }, Coerce: database.CoerceTime},
	domain.SessionFieldExpiresAt:  {SQLName: "s.expires_at", Accessor: func(s *domain.Session) any { return s.ExpiresAt }, Coerce: database.CoerceTime},
	domain.SessionFieldTimeToLive: {SQLName: "s.time_to_live", Accessor: func(s *domain.Session) any { return s.TimeToLive.Nanoseconds() }, Coerce: coerceSessionDuration},
	// token_id is NULL until the session token is created; "" is never stored.
	domain.SessionFieldTokenID: {SQLName: "s.token_id", Accessor: func(s *domain.Session) any {
		if s.TokenID == "" {
			return nil
		}
		return s.TokenID
	}, Coerce: database.CoerceString, Nullable: true},
	domain.SessionFieldUserID: {SQLName: "s.user_id", Accessor: func(s *domain.Session) any { return database.NullableValue(s.UserID) }, Coerce: database.CoerceString, Nullable: true},
	// Not a column: a correlated EXISTS over the session's verified checks,
	// backing the computed state filter.
	domain.SessionFieldHasVerifiedFactors: {
		SQLName: "EXISTS (SELECT 1 FROM checks vc WHERE vc.project_id = s.project_id AND vc.session_id = s.id AND vc.last_verified_at IS NOT NULL)",
	},
})
