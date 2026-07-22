package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const (
	userAgentFingerprintKey = "fingerprint"

	insertUserAgentStmt = `INSERT INTO zitadel_nextgen.user_agents (project_id, info) VALUES ($1, $2) RETURNING id`
	insertSessionStmt   = `INSERT INTO zitadel_nextgen.sessions (project_id, user_agent_id, time_to_live, token_id)
VALUES ($1, $2, $3::INTERVAL, 0) RETURNING id, created_at, updated_at, expires_at`
	updateSessionTokenIDStmt = `UPDATE zitadel_nextgen.sessions SET token_id = $3 WHERE project_id = $1 AND id = $2`
	deleteSessionByIDStmt    = `DELETE FROM zitadel_nextgen.sessions WHERE project_id = $1 AND id = $2`
	sessionQuery             = `SELECT s.project_id, s.id, s.created_at, s.updated_at, s.expires_at, s.time_to_live, s.token_id, s.user_id,
	ua.id, ua.info,
	c.type, c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload
FROM zitadel_nextgen.sessions s
LEFT JOIN zitadel_nextgen.user_agents ua ON s.project_id = ua.project_id AND s.user_agent_id = ua.id
LEFT JOIN zitadel_nextgen.checks c ON c.project_id = s.project_id AND c.session_id = s.id`
	authAttemptByHandoffQuery = `SELECT aa.project_id, aa.id, aa.handoff_token, aa.handed_off_at, aa.session_id,
	aa.required_checks, aa.created_at, c.type, aa.time_to_live,
	c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload
FROM zitadel_nextgen.auth_attempts aa
LEFT JOIN zitadel_nextgen.checks c ON aa.project_id = c.project_id AND aa.id = c.auth_attempt_id
WHERE aa.project_id = $1 AND aa.handoff_token = $2`
	deleteAuthAttemptStmt       = `DELETE FROM zitadel_nextgen.auth_attempts WHERE project_id = $1 AND id = $2`
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
	return ss.insertSession(ctx, session)
}

func (ss sessionStatements) GetSessionByID(ctx context.Context, projectID, sessionID string) (*domain.Session, error) {
	sessions, err := ss.querySessions(ctx, &database.ListOptions[domain.SessionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.SessionFieldProjectID), projectID),
			database.Equal(database.Col(domain.SessionFieldID), storagedb.Identity(sessionID)),
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
	tag, err := ss.client.Exec(ctx, deleteSessionByIDStmt, projectID, storagedb.Identity(sessionID))
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

func (ss sessionStatements) ExchangeSession(ctx context.Context, projectID, handoffToken string, _ *string, ttl time.Duration) (*domain.Session, error) {
	attempt, err := ss.getAuthAttemptByHandoffToken(ctx, projectID, hashHandoffToken(handoffToken))
	if err != nil {
		if errors.Is(err, domain.ErrAuthAttemptNotFound()) {
			return nil, domain.ErrSessionInvalidHandoffToken()
		}
		return nil, err
	}
	if err := validateHandoffAttempt(attempt); err != nil {
		return nil, err
	}
	if !attempt.IsCompleted() {
		return nil, domain.ErrSessionInvalidHandoffToken()
	}

	var targetSession *domain.Session
	if attempt.SessionID != nil {
		targetSession, err = ss.GetSessionByID(ctx, projectID, *attempt.SessionID)
		if err != nil {
			if errors.Is(err, domain.ErrSessionNotFound()) {
				return nil, domain.ErrSessionExchangeConflict()
			}
			return nil, err
		}
	} else {
		targetSession = &domain.Session{ProjectID: projectID, TimeToLive: exchangeTTL(ttl)}
		if err := ss.insertSession(ctx, targetSession); err != nil {
			return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
		}
	}

	attemptChecks, err := ss.loadStoredChecks(ctx, loadAttemptChecksStmt, projectID, attempt.ID, true)
	if err != nil {
		return nil, err
	}
	sessionChecks, err := ss.loadStoredChecks(ctx, loadSessionChecksStmt, projectID, targetSession.ID, false)
	if err != nil {
		return nil, err
	}
	lastVerifiedChecks := pickLastVerifiedChecksByType(attemptChecks, sessionChecks)
	if err := ss.applyExchange(ctx, projectID, targetSession.ID, lastVerifiedChecks); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	userID, err := ss.userIDFromLastVerifiedChecks(ctx, projectID, lastVerifiedChecks)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	oldTokenID := targetSession.TokenID
	if err := ss.updateSessionAfterExchange(ctx, projectID, targetSession.ID, userID, ttl); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	if _, err := ss.client.Exec(ctx, deleteAuthAttemptStmt, projectID, storagedb.Identity(attempt.ID)); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), wrapError(err))
	}
	refreshed, err := ss.GetSessionByID(ctx, projectID, targetSession.ID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	if err := ss.createSessionToken(ctx, refreshed, oldTokenID); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	return refreshed, nil
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

func (ss sessionStatements) insertSession(ctx context.Context, session *domain.Session) error {
	if session.TimeToLive <= 0 {
		session.TimeToLive = domain.SessionAnonymousTTL
	}
	var userAgentID storagedb.Identity
	if session.UserAgent != nil {
		info := session.UserAgent.Info
		if info == nil {
			info = map[string]any{}
		}
		if session.UserAgent.IP != "" {
			info["ip"] = session.UserAgent.IP
		}
		if session.UserAgent.ID != "" {
			info[userAgentFingerprintKey] = session.UserAgent.ID
		}
		raw, err := json.Marshal(info)
		if err != nil {
			return fmt.Errorf("failed to marshal user agent info: %w", err)
		}
		if err := ss.client.QueryRow(ctx, insertUserAgentStmt, session.ProjectID, raw).Scan(&userAgentID); err != nil {
			return fmt.Errorf("failed to insert user agent: %w", wrapError(err))
		}
	}
	var sessionID storagedb.Identity
	err := ss.client.QueryRow(ctx, insertSessionStmt, session.ProjectID, userAgentID, session.TimeToLive).
		Scan(&sessionID, &session.CreatedAt, &session.UpdatedAt, &session.ExpiresAt)
	if err != nil {
		return fmt.Errorf("failed to insert session: %w", wrapError(err))
	}
	session.ID = sessionID.String()
	return ss.createSessionToken(ctx, session, "")
}

func (ss sessionStatements) createSessionToken(ctx context.Context, session *domain.Session, previousTokenID string) error {
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
	if _, err := ss.client.Exec(ctx, updateSessionTokenIDStmt, session.ProjectID, storagedb.Identity(session.ID), storagedb.Identity(tok.TokenID)); err != nil {
		return fmt.Errorf("failed to set session token_id: %w", wrapError(err))
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
	args := []any{projectID, storagedb.Identity(sessionID)}
	sql := `UPDATE zitadel_nextgen.sessions SET updated_at = NOW()`
	if userID != nil {
		args = append(args, *userID)
		sql += fmt.Sprintf(", user_id = $%d", len(args))
	}
	if ttl > 0 {
		args = append(args, ttl)
		sql += fmt.Sprintf(", time_to_live = $%d::INTERVAL", len(args))
	}
	sql += " WHERE project_id = $1 AND id = $2"
	tag, err := ss.client.Exec(ctx, sql, args...)
	if err != nil {
		return wrapError(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

func (ss sessionStatements) applyExchange(ctx context.Context, projectID, sessionID string, lastVerifiedChecks map[domain.AuthCheckType]storedCheck) error {
	for _, c := range lastVerifiedChecks {
		if !c.OnAttempt {
			continue
		}
		tag, err := ss.client.Exec(ctx, promoteCheckStmt, storagedb.Identity(sessionID), projectID, storagedb.Identity(c.ID))
		if err != nil {
			return wrapError(err)
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("failed to promote check %s", c.ID)
		}
	}
	for _, c := range lastVerifiedChecks {
		if _, err := ss.client.Exec(ctx, deleteSessionCheckLoserStmt, projectID, storagedb.Identity(sessionID), c.Type, storagedb.Identity(c.ID)); err != nil {
			return wrapError(err)
		}
	}
	return nil
}

func (ss sessionStatements) userIDFromLastVerifiedChecks(ctx context.Context, projectID string, lastVerifiedChecks map[domain.AuthCheckType]storedCheck) (*string, error) {
	w, ok := lastVerifiedChecks[domain.AuthCheckTypeUser]
	if !ok {
		return nil, nil
	}
	var factor []byte
	if err := ss.client.QueryRow(ctx, selectFactorPayloadStmt, projectID, storagedb.Identity(w.ID)).Scan(&factor); err != nil {
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

func (ss sessionStatements) loadStoredChecks(ctx context.Context, query, projectID, id string, onAttempt bool) ([]storedCheck, error) {
	rows, err := ss.client.Query(ctx, query, projectID, storagedb.Identity(id))
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	var out []storedCheck
	for rows.Next() {
		var checkID storagedb.Identity
		var typ int64
		var lastVerifiedAt time.Time
		if err := rows.Scan(&checkID, &typ, &lastVerifiedAt); err != nil {
			return nil, err
		}
		out = append(out, storedCheck{ID: checkID.String(), Type: domain.AuthCheckType(typ), LastVerifiedAt: lastVerifiedAt, OnAttempt: onAttempt})
	}
	return out, rows.Err()
}

func (ss sessionStatements) getAuthAttemptByHandoffToken(ctx context.Context, projectID string, handoffToken []byte) (*domain.AuthAttempt, error) {
	rows, err := ss.client.Query(ctx, authAttemptByHandoffQuery, projectID, handoffToken)
	if err != nil {
		return nil, wrapError(err)
	}
	defer rows.Close()
	attempt := new(domain.AuthAttempt)
	if err := scanAuthAttempt(rows, attempt); err != nil {
		return nil, err
	}
	return attempt, nil
}

type storedCheck struct {
	ID             string
	Type           domain.AuthCheckType
	LastVerifiedAt time.Time
	OnAttempt      bool
}

func scanSessions(rows pgx.Rows) ([]*domain.Session, error) {
	byID := map[string]*domain.Session{}
	order := []string{}
	for rows.Next() {
		var (
			projectID                                      string
			sessionID, tokenID, checkID                    storagedb.Identity
			createdAt, updatedAt, expiresAt                time.Time
			timeToLive                                     time.Duration
			userID                                         *string
			userAgentID                                    *int64
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
		id := sessionID.String()
		session, ok := byID[id]
		if !ok {
			session = &domain.Session{ProjectID: projectID, ID: id, CreatedAt: createdAt, UpdatedAt: updatedAt, ExpiresAt: expiresAt, TimeToLive: timeToLive, TokenID: tokenID.String(), UserID: userID}
			if userAgentID != nil {
				info := map[string]any{}
				if len(userAgentInfo) > 0 {
					if err := json.Unmarshal(userAgentInfo, &info); err != nil {
						return nil, fmt.Errorf("failed to unmarshal user agent info: %w", err)
					}
				}
				session.UserAgent = userAgentFromStoredInfo(info)
			}
			byID[id] = session
			order = append(order, id)
		}
		if checkType == nil || checkID.String() == "" {
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
		checks, err := newSessionAuthChecks(domain.AuthCheckType(*checkType), checkID.String(), challengedAt, failedAt, verifiedAt, failures, challenge, factor)
		if err != nil {
			return nil, err
		}
		for _, check := range checks {
			if f, ok := check.(domain.AuthFactor); ok {
				appendSessionFactor(session, f)
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

func scanAuthAttempt(rows pgx.Rows, attempt *domain.AuthAttempt) error {
	var found bool
	for rows.Next() {
		found = true
		var (
			attemptID                                  storagedb.Identity
			handoffToken                               []byte
			handedOffAt                                *time.Time
			sessionID                                  *int64
			requiredChecks                             []int16
			checkType                                  *domain.AuthCheckType
			timeToLive                                 *time.Duration
			challengeID                                *string
			lastChallengedAt, verifiedAt, lastFailedAt *time.Time
			failureCount                               *uint16
			challenge, factor                          []byte
		)
		if err := rows.Scan(&attempt.ProjectID, &attemptID, &handoffToken, &handedOffAt, &sessionID, &requiredChecks, &attempt.CreatedAt, &checkType, &timeToLive, &challengeID, &lastChallengedAt, &verifiedAt, &lastFailedAt, &failureCount, &challenge, &factor); err != nil {
			return fmt.Errorf("failed to scan auth attempt: %w", err)
		}
		attempt.ID = attemptID.String()
		attempt.RequiredChecks = make([]domain.AuthCheckType, len(requiredChecks))
		for i, c := range requiredChecks {
			attempt.RequiredChecks[i] = domain.AuthCheckType(c)
		}
		if len(handoffToken) > 0 {
			attempt.HandoffToken = &domain.HandoffToken{TokenHash: handoffToken}
		}
		attempt.HandedOffAt = handedOffAt
		if sessionID != nil {
			s := strconv.FormatInt(*sessionID, 10)
			attempt.SessionID = &s
		}
		attempt.TimeToLive = timeToLive
		if checkType == nil {
			continue
		}
		var cid string
		var challengedAt, failedAt, verified time.Time
		var failures uint16
		if challengeID != nil {
			cid = *challengeID
		}
		if lastChallengedAt != nil {
			challengedAt = *lastChallengedAt
		}
		if lastFailedAt != nil {
			failedAt = *lastFailedAt
		}
		if verifiedAt != nil {
			verified = *verifiedAt
		}
		if failureCount != nil {
			failures = *failureCount
		}
		checks, err := newSessionAuthChecks(*checkType, cid, challengedAt, failedAt, verified, failures, challenge, factor)
		if err != nil {
			return fmt.Errorf("failed to unmarshal auth check: %w", err)
		}
		for _, checker := range checks {
			attempt.SetCheck(checker)
		}
	}
	if !found {
		return domain.ErrAuthAttemptNotFound()
	}
	return rows.Err()
}

func newSessionAuthChecks(checkType domain.AuthCheckType, id string, lastChallengedAt, lastFailedAt, verifiedAt time.Time, failureCount uint16, challenge, factor json.RawMessage) (checks []domain.AuthCheck, err error) {
	switch checkType {
	case domain.AuthCheckTypeUser:
		if !verifiedAt.IsZero() {
			userFactor := domain.SetAuthFactorUser(verifiedAt)
			if len(factor) > 0 {
				if err = json.Unmarshal(factor, &userFactor); err != nil {
					return nil, fmt.Errorf("failed to unmarshal user auth check factor payload: %w", err)
				}
			}
			checks = append(checks, userFactor)
		}
		if !lastChallengedAt.IsZero() {
			checks = append(checks, domain.SetAuthChallengeUser(id, lastChallengedAt, lastFailedAt, failureCount))
		}
	case domain.AuthCheckTypePassword:
		if !verifiedAt.IsZero() {
			checks = append(checks, domain.SetAuthFactorPassword(verifiedAt))
		}
		if !lastChallengedAt.IsZero() {
			checks = append(checks, domain.SetAuthChallengePassword(id, lastChallengedAt, lastFailedAt, failureCount))
		}
	case domain.AuthCheckTypePasskey:
		if !verifiedAt.IsZero() {
			passkeyFactor := domain.SetAuthFactorPasskey(verifiedAt)
			if len(factor) > 0 {
				if err = json.Unmarshal(factor, passkeyFactor); err != nil {
					return nil, fmt.Errorf("failed to unmarshal passkey auth check factor payload: %w", err)
				}
			}
			checks = append(checks, passkeyFactor)
		}
		if !lastChallengedAt.IsZero() {
			passkeyCheck := domain.SetAuthChallengePasskey(id, lastChallengedAt, lastFailedAt, failureCount)
			if len(challenge) > 0 {
				if err = json.Unmarshal(challenge, passkeyCheck); err != nil {
					return nil, fmt.Errorf("failed to unmarshal passkey auth check challenge payload: %w", err)
				}
			}
			checks = append(checks, passkeyCheck)
		}
	default:
		slog.Error("unsupported auth check type", slog.Any("check_type", checkType))
	}
	return checks, nil
}

func hashHandoffToken(plain string) []byte { sum := sha256.Sum256([]byte(plain)); return sum[:] }
func exchangeTTL(ttl time.Duration) time.Duration {
	if ttl > 0 {
		return ttl
	}
	return domain.SessionAnonymousTTL
}
func validateHandoffAttempt(attempt *domain.AuthAttempt) error {
	if attempt.HandoffToken == nil || attempt.HandedOffAt == nil || attempt.HandedOffAt.IsZero() {
		return domain.ErrSessionInvalidHandoffToken()
	}
	if time.Now().After(attempt.HandoffToken.ExpiresAt(attempt.HandedOffAt)) {
		return domain.ErrSessionInvalidHandoffToken()
	}
	if attempt.IsExpired() {
		return domain.ErrSessionInvalidHandoffToken()
	}
	return nil
}
func pickLastVerifiedChecksByType(attemptChecks, sessionChecks []storedCheck) map[domain.AuthCheckType]storedCheck {
	out := map[domain.AuthCheckType]storedCheck{}
	for _, c := range sessionChecks {
		out[c.Type] = c
	}
	for _, c := range attemptChecks {
		existing, ok := out[c.Type]
		if !ok || c.LastVerifiedAt.After(existing.LastVerifiedAt) {
			out[c.Type] = c
		}
	}
	return out
}
func userAgentFromStoredInfo(info map[string]any) *domain.UserAgent {
	ua := &domain.UserAgent{Info: info}
	if ip, ok := info["ip"].(string); ok {
		ua.IP = ip
	}
	if fp, ok := info[userAgentFingerprintKey].(string); ok {
		ua.ID = fp
	}
	return ua
}
func appendSessionFactor(session *domain.Session, factor domain.AuthFactor) {
	for i, f := range session.Factors {
		if f.Type() == factor.Type() {
			session.Factors[i] = factor
			return
		}
	}
	session.Factors = append(session.Factors, factor)
}
func coerceSessionIdentity(v any) (any, error) {
	switch id := v.(type) {
	case storagedb.Identity:
		return id, nil
	case string:
		return storagedb.Identity(id), nil
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

var sessionSchema = database.NewSchema(map[domain.SessionField]database.FieldBinding[domain.Session]{
	domain.SessionFieldProjectID:  {SQLName: "s.project_id", Accessor: func(s *domain.Session) any { return s.ProjectID }, Coerce: database.CoerceString},
	domain.SessionFieldID:         {SQLName: "s.id", Accessor: func(s *domain.Session) any { return storagedb.Identity(s.ID) }, Coerce: coerceSessionIdentity},
	domain.SessionFieldCreatedAt:  {SQLName: "s.created_at", Accessor: func(s *domain.Session) any { return s.CreatedAt }, Coerce: database.CoerceTime},
	domain.SessionFieldUpdatedAt:  {SQLName: "s.updated_at", Accessor: func(s *domain.Session) any { return s.UpdatedAt }, Coerce: database.CoerceTime},
	domain.SessionFieldExpiresAt:  {SQLName: "s.expires_at", Accessor: func(s *domain.Session) any { return s.ExpiresAt }, Coerce: database.CoerceTime},
	domain.SessionFieldTimeToLive: {SQLName: "s.time_to_live", Accessor: func(s *domain.Session) any { return s.TimeToLive }, Coerce: coerceSessionDuration},
	domain.SessionFieldTokenID:    {SQLName: "s.token_id", Accessor: func(s *domain.Session) any { return storagedb.Identity(s.TokenID) }, Coerce: coerceSessionIdentity},
	domain.SessionFieldUserID: {SQLName: "s.user_id", Accessor: func(s *domain.Session) any {
		if s.UserID == nil {
			return ""
		}
		return *s.UserID
	}, Coerce: database.CoerceString},
})
