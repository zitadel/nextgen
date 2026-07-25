package spanner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
	v2session "github.com/zitadel/nextgen/internal/storage/v2/session"
)

type sessionStatements struct{ statement }

func newSessionStatements(db queryExecutor) sessionStatements {
	return sessionStatements{statement: statement{db: db}}
}

func (ss sessionStatements) CreateSession(ctx context.Context, session *domain.Session) error {
	return withTransaction(ctx, ss.db, func(ctx context.Context, tx queryExecutor) error {
		return sessionStatements{statement: statement{db: tx}}.insertSession(ctx, session)
	})
}

func (ss sessionStatements) GetSessionByID(ctx context.Context, projectID, sessionID string) (*domain.Session, error) {
	id, err := parseSessionIdentity(sessionID)
	if err != nil {
		return nil, err
	}
	sessions, err := ss.querySessions(ctx, &database.ListOptions[domain.SessionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.SessionFieldProjectID), projectID),
			database.Equal(database.Col(domain.SessionFieldID), id),
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
	id, err := parseSessionIdentity(sessionID)
	if err != nil {
		return err
	}
	n, err := ss.db.Update(ctx, buildStatement(`DELETE FROM sessions WHERE project_id = @p1 AND id = @p2`, projectID, id).statement())
	if err != nil {
		return err
	}
	if n == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

func (ss sessionStatements) ExchangeSession(ctx context.Context, projectID, handoffToken string, _ *string, ttl time.Duration) (*domain.Session, error) {
	var refreshed *domain.Session
	err := withTransaction(ctx, ss.db, func(ctx context.Context, tx queryExecutor) error {
		var err error
		refreshed, err = sessionStatements{statement: statement{db: tx}}.exchangeSessionTx(ctx, projectID, handoffToken, ttl)
		return err
	})
	return refreshed, err
}

func (ss sessionStatements) exchangeSessionTx(ctx context.Context, projectID, handoffToken string, ttl time.Duration) (*domain.Session, error) {
	attempt, err := ss.getAuthAttemptByHandoffToken(ctx, projectID, v2session.HashHandoffToken(handoffToken))
	if err != nil {
		if errors.Is(err, domain.ErrAuthAttemptNotFound()) {
			return nil, domain.ErrSessionInvalidHandoffToken()
		}
		return nil, err
	}
	if err := v2session.ValidateHandoffAttempt(attempt); err != nil {
		return nil, err
	}
	if !attempt.IsCompleted() {
		return nil, domain.ErrSessionInvalidHandoffToken()
	}
	var target *domain.Session
	if attempt.SessionID != nil {
		target, err = ss.GetSessionByID(ctx, projectID, *attempt.SessionID)
		if err != nil {
			if errors.Is(err, domain.ErrSessionNotFound()) {
				return nil, domain.ErrSessionExchangeConflict()
			}
			return nil, err
		}
	} else {
		target = &domain.Session{ProjectID: projectID, TimeToLive: v2session.ExchangeTTL(ttl)}
		if err := ss.insertSession(ctx, target); err != nil {
			return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
		}
	}
	attemptChecks, err := ss.loadStoredChecks(ctx, true, projectID, attempt.ID)
	if err != nil {
		return nil, err
	}
	sessionChecks, err := ss.loadStoredChecks(ctx, false, projectID, target.ID)
	if err != nil {
		return nil, err
	}
	last := v2session.PickLastVerifiedByType(attemptChecks, sessionChecks)
	if err := ss.applyExchange(ctx, projectID, target.ID, last); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	userID, err := ss.userIDFromLastVerifiedChecks(ctx, projectID, last)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	oldTokenID := target.TokenID
	if err := ss.updateSessionAfterExchange(ctx, projectID, target.ID, userID, ttl); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	aid, err := parseSessionIdentity(attempt.ID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	if _, err := ss.db.Update(ctx, buildStatement(`DELETE FROM auth_attempts WHERE project_id = @p1 AND id = @p2`, projectID, aid).statement()); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	refreshed, err := ss.GetSessionByID(ctx, projectID, target.ID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	if err := ss.createSessionToken(ctx, refreshed, oldTokenID); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	return refreshed, nil
}

const sessionQuery = `SELECT s.project_id, s.id, s.created_at, s.updated_at, s.expires_at, s.time_to_live, s.token_id, s.user_id,
	ua.id, ua.info,
	c.type, c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload
FROM sessions s
LEFT JOIN user_agents ua ON s.project_id = ua.project_id AND s.user_agent_id = ua.id
LEFT JOIN checks c ON c.project_id = s.project_id AND c.session_id = s.id`

func (ss sessionStatements) querySessions(ctx context.Context, filter *database.ListOptions[domain.SessionField]) ([]*domain.Session, error) {
	var compiler statementCompiler
	if err := compileRead(&compiler, sessionQuery, filter, sessionSchema); err != nil {
		return nil, err
	}
	var sessions []*domain.Session
	err := ss.db.Query(ctx, compiler.statement(), func(iter *spanner.RowIterator) error {
		var err error
		sessions, err = scanSessions(iter)
		return err
	})
	return sessions, err
}

func (ss sessionStatements) insertSession(ctx context.Context, session *domain.Session) error {
	if session.TimeToLive <= 0 {
		session.TimeToLive = domain.SessionAnonymousTTL
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
		stmt := buildStatement(`INSERT INTO user_agents (project_id, info) VALUES (@p1, @p2) THEN RETURN id`, session.ProjectID, encodeSpannerJSON(raw)).statement()
		err = ss.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
			_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
				var id storagedb.Identity
				if err := row.Columns(&id); err != nil {
					return struct{}{}, err
				}
				parsed, err := parseSessionIdentity(id.String())
				if err != nil {
					return struct{}{}, err
				}
				userAgentID = parsed
				return struct{}{}, nil
			})
			return err
		})
		if err != nil {
			return fmt.Errorf("failed to insert user agent: %w", err)
		}
	}
	stmt := buildStatement(`INSERT INTO sessions (project_id, user_agent_id, time_to_live, token_id, created_at, updated_at) VALUES (@p1, @p2, @p3, 0, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()) THEN RETURN id, created_at, updated_at, expires_at`,
		session.ProjectID, userAgentID, session.TimeToLive.Nanoseconds()).statement()
	err := ss.db.Write(ctx, stmt, func(iter *spanner.RowIterator) error {
		_, err := collectOneRow(iter, func(row *spanner.Row) (struct{}, error) {
			var sessionID storagedb.Identity
			if err := row.Columns(&sessionID, &session.CreatedAt, &session.UpdatedAt, &session.ExpiresAt); err != nil {
				return struct{}{}, err
			}
			session.ID = sessionID.String()
			return struct{}{}, nil
		})
		return err
	})
	if err != nil {
		return fmt.Errorf("failed to insert session: %w", err)
	}
	return ss.createSessionToken(ctx, session, "")
}

func (ss sessionStatements) createSessionToken(ctx context.Context, session *domain.Session, previousTokenID string) error {
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
	sessionID, err := parseSessionIdentity(session.ID)
	if err != nil {
		return err
	}
	tokenID, err := parseTokenIdentity(tok.TokenID)
	if err != nil {
		return err
	}
	if _, err := ss.db.Update(ctx, buildStatement(`UPDATE sessions SET token_id = @p3 WHERE project_id = @p1 AND id = @p2`, session.ProjectID, sessionID, tokenID).statement()); err != nil {
		return fmt.Errorf("failed to set session token_id: %w", err)
	}
	session.TokenID = tok.TokenID
	if previousTokenID != "" && previousTokenID != "0" {
		if err := tokens.DeleteTokenByID(ctx, session.ProjectID, previousTokenID); err != nil {
			return fmt.Errorf("failed to revoke previous session token: %w", err)
		}
	}
	return nil
}

func (ss sessionStatements) updateSessionAfterExchange(ctx context.Context, projectID, sessionID string, userID *string, ttl time.Duration) error {
	id, err := parseSessionIdentity(sessionID)
	if err != nil {
		return err
	}
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
	c.WriteArg(id)
	n, err := ss.db.Update(ctx, c.statement())
	if err != nil {
		return err
	}
	if n == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

func (ss sessionStatements) applyExchange(ctx context.Context, projectID, sessionID string, last map[domain.AuthCheckType]v2session.StoredCheck) error {
	sid, err := parseSessionIdentity(sessionID)
	if err != nil {
		return err
	}
	for _, c := range last {
		if !c.OnAttempt {
			continue
		}
		cid, err := parseSessionIdentity(c.ID)
		if err != nil {
			return err
		}
		n, err := ss.db.Update(ctx, buildStatement(`UPDATE checks SET session_id = @p1, auth_attempt_id = NULL, challenge_payload = NULL, last_challenged_at = NULL, last_failed_at = NULL, failure_count = 0 WHERE project_id = @p2 AND id = @p3 AND auth_attempt_id IS NOT NULL`, sid, projectID, cid).statement())
		if err != nil {
			return err
		}
		if n == 0 {
			return fmt.Errorf("failed to promote check %s", c.ID)
		}
	}
	for _, c := range last {
		cid, err := parseSessionIdentity(c.ID)
		if err != nil {
			return err
		}
		if _, err := ss.db.Update(ctx, buildStatement(`DELETE FROM checks WHERE project_id = @p1 AND session_id = @p2 AND type = @p3 AND id <> @p4`, projectID, sid, int64(c.Type), cid).statement()); err != nil {
			return err
		}
	}
	return nil
}

func (ss sessionStatements) userIDFromLastVerifiedChecks(ctx context.Context, projectID string, last map[domain.AuthCheckType]v2session.StoredCheck) (*string, error) {
	w, ok := last[domain.AuthCheckTypeUser]
	if !ok {
		return nil, nil
	}
	cid, err := parseSessionIdentity(w.ID)
	if err != nil {
		return nil, err
	}
	var factor spanner.NullJSON
	err = ss.db.Query(ctx, buildStatement(`SELECT factor_payload FROM checks WHERE project_id = @p1 AND id = @p2`, projectID, cid).statement(), func(iter *spanner.RowIterator) error {
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

func (ss sessionStatements) loadStoredChecks(ctx context.Context, onAttempt bool, projectID, id string) ([]v2session.StoredCheck, error) {
	parsed, err := parseSessionIdentity(id)
	if err != nil {
		return nil, err
	}
	query := `SELECT id, type, last_verified_at FROM checks WHERE project_id = @p1 AND session_id = @p2 AND last_verified_at IS NOT NULL`
	if onAttempt {
		query = `SELECT id, type, last_verified_at FROM checks WHERE project_id = @p1 AND auth_attempt_id = @p2 AND last_verified_at IS NOT NULL`
	}
	var out []v2session.StoredCheck
	err = ss.db.Query(ctx, buildStatement(query, projectID, parsed).statement(), func(iter *spanner.RowIterator) error {
		return iter.Do(func(row *spanner.Row) error {
			var cid storagedb.Identity
			var typ int64
			var at time.Time
			if err := row.Columns(&cid, &typ, &at); err != nil {
				return err
			}
			out = append(out, v2session.StoredCheck{ID: cid.String(), Type: domain.AuthCheckType(typ), LastVerifiedAt: at, OnAttempt: onAttempt})
			return nil
		})
	})
	return out, err
}

func (ss sessionStatements) getAuthAttemptByHandoffToken(ctx context.Context, projectID string, handoffToken []byte) (*domain.AuthAttempt, error) {
	attempt := new(domain.AuthAttempt)
	q := `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id, aa.required_checks, aa.created_at, c.type, aa.time_to_live, c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload FROM auth_attempts aa LEFT JOIN checks c ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id WHERE aa.project_id = @p1 AND aa.handoff_token = @p2`
	err := ss.db.Query(ctx, buildStatement(q, projectID, handoffToken).statement(), func(iter *spanner.RowIterator) error {
		return scanAuthAttempt(iter, attempt)
	})
	if err != nil {
		return nil, err
	}
	return attempt, nil
}

func scanSessions(iter *spanner.RowIterator) ([]*domain.Session, error) {
	byID := map[string]*domain.Session{}
	order := []string{}
	err := iter.Do(func(row *spanner.Row) error {
		var (
			projectID                                      string
			sessionID, tokenID                             storagedb.Identity
			createdAt, updatedAt, expiresAt                time.Time
			timeToLiveNanos                                int64
			userID                                         spanner.NullString
			userAgentID, checkType, checkID, failureCount  spanner.NullInt64
			userAgentInfo, challenge, factor               spanner.NullJSON
			lastChallengedAt, lastVerifiedAt, lastFailedAt spanner.NullTime
		)
		if err := row.Columns(&projectID, &sessionID, &createdAt, &updatedAt, &expiresAt, &timeToLiveNanos, &tokenID, &userID,
			&userAgentID, &userAgentInfo, &checkType, &checkID, &lastChallengedAt, &lastVerifiedAt, &lastFailedAt, &failureCount, &challenge, &factor); err != nil {
			return fmt.Errorf("failed to scan session row: %w", err)
		}
		id := sessionID.String()
		session, ok := byID[id]
		if !ok {
			session = &domain.Session{ProjectID: projectID, ID: id, CreatedAt: createdAt, UpdatedAt: updatedAt, ExpiresAt: expiresAt, TimeToLive: time.Duration(timeToLiveNanos), TokenID: tokenID.String()}
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
		checks, err := v2session.DecodeAuthChecks(domain.AuthCheckType(checkType.Int64), strconv.FormatInt(checkID.Int64, 10), nullTime(lastChallengedAt), nullTime(lastFailedAt), nullTime(lastVerifiedAt), uint16(failureCount.Int64), nullJSONBytes(challenge), nullJSONBytes(factor))
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

func scanAuthAttempt(iter *spanner.RowIterator, attempt *domain.AuthAttempt) error {
	var found bool
	err := iter.Do(func(row *spanner.Row) error {
		found = true
		var (
			attemptID                                             storagedb.Identity
			handoffToken                                          []byte
			handedOffAt                                           spanner.NullTime
			sessionID                                             spanner.NullInt64
			requiredChecks                                        []spanner.NullInt64
			checkType, timeToLiveNanos, challengeID, failureCount spanner.NullInt64
			lastChallengedAt, verifiedAt, lastFailedAt            spanner.NullTime
			challenge, factor                                     spanner.NullJSON
		)
		if err := row.Columns(&attempt.ProjectID, &attemptID, &handoffToken, &handedOffAt, &sessionID, &requiredChecks, &attempt.CreatedAt, &checkType, &timeToLiveNanos, &challengeID, &lastChallengedAt, &verifiedAt, &lastFailedAt, &failureCount, &challenge, &factor); err != nil {
			return fmt.Errorf("failed to scan auth attempt: %w", err)
		}
		attempt.ID = attemptID.String()
		attempt.RequiredChecks = nil
		for _, c := range requiredChecks {
			if c.Valid {
				attempt.RequiredChecks = append(attempt.RequiredChecks, domain.AuthCheckType(c.Int64))
			}
		}
		if len(handoffToken) > 0 {
			attempt.HandoffToken = &domain.HandoffToken{TokenHash: handoffToken}
		}
		if handedOffAt.Valid {
			t := handedOffAt.Time
			attempt.HandedOffAt = &t
		}
		if sessionID.Valid {
			s := strconv.FormatInt(sessionID.Int64, 10)
			attempt.SessionID = &s
		}
		if timeToLiveNanos.Valid {
			d := time.Duration(timeToLiveNanos.Int64)
			attempt.TimeToLive = &d
		}
		if !checkType.Valid {
			return nil
		}
		var cid string
		if challengeID.Valid {
			cid = strconv.FormatInt(challengeID.Int64, 10)
		}
		checks, err := v2session.DecodeAuthChecks(domain.AuthCheckType(checkType.Int64), cid, nullTime(lastChallengedAt), nullTime(lastFailedAt), nullTime(verifiedAt), uint16(failureCount.Int64), nullJSONBytes(challenge), nullJSONBytes(factor))
		if err != nil {
			return err
		}
		for _, checker := range checks {
			attempt.SetCheck(checker)
		}
		return nil
	})
	if err != nil {
		return wrapError(err)
	}
	if !found {
		return domain.ErrAuthAttemptNotFound()
	}
	return nil
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
func parseSessionIdentity(id string) (int64, error) {
	parsed, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid session identity %q: %w", id, err)
	}
	return parsed, nil
}
func coerceSessionIdentity(v any) (any, error) {
	switch id := v.(type) {
	case storagedb.Identity:
		return id, nil
	case string:
		return storagedb.Identity(id), nil
	case int64:
		return storagedb.Identity(strconv.FormatInt(id, 10)), nil
	default:
		s, err := database.CoerceStringValue(v)
		if err != nil {
			return nil, err
		}
		return storagedb.Identity(s), nil
	}
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

var sessionSchema = database.NewSchema(map[domain.SessionField]database.FieldBinding[domain.Session]{
	domain.SessionFieldProjectID:  {SQLName: "s.project_id", Accessor: func(s *domain.Session) any { return s.ProjectID }, Coerce: database.CoerceString},
	domain.SessionFieldID:         {SQLName: "s.id", Accessor: func(s *domain.Session) any { return storagedb.Identity(s.ID) }, Coerce: coerceSessionIdentity},
	domain.SessionFieldCreatedAt:  {SQLName: "s.created_at", Accessor: func(s *domain.Session) any { return s.CreatedAt }, Coerce: database.CoerceTime},
	domain.SessionFieldUpdatedAt:  {SQLName: "s.updated_at", Accessor: func(s *domain.Session) any { return s.UpdatedAt }, Coerce: database.CoerceTime},
	domain.SessionFieldExpiresAt:  {SQLName: "s.expires_at", Accessor: func(s *domain.Session) any { return s.ExpiresAt }, Coerce: database.CoerceTime},
	domain.SessionFieldTimeToLive: {SQLName: "s.time_to_live", Accessor: func(s *domain.Session) any { return s.TimeToLive.Nanoseconds() }, Coerce: coerceSessionDuration},
	domain.SessionFieldTokenID:    {SQLName: "s.token_id", Accessor: func(s *domain.Session) any { return storagedb.Identity(s.TokenID) }, Coerce: coerceSessionIdentity},
	domain.SessionFieldUserID: {SQLName: "s.user_id", Accessor: func(s *domain.Session) any {
		if s.UserID == nil {
			return ""
		}
		return *s.UserID
	}, Coerce: database.CoerceString},
})
