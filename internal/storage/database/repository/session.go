package repository

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

const (
	pgSchema = "zitadel_nextgen."

	pgTableSessions     = pgSchema + "sessions"
	pgTableUserAgents   = pgSchema + "user_agents"
	pgTableChecks       = pgSchema + "checks"
	pgTableAuthAttempts = pgSchema + "auth_attempts"

	spannerTableSessions     = "sessions"
	spannerTableUserAgents   = "user_agents"
	spannerTableChecks       = "checks"
	spannerTableAuthAttempts = "auth_attempts"

	userAgentFingerprintKey = "fingerprint"
)

type sessionMeta struct {
	tableName string
}

func (m sessionMeta) PrimaryKeyColumns() []database.Column {
	return []database.Column{
		database.NewColumn(m.tableName, "project_id"),
		database.NewColumn(m.tableName, "id"),
	}
}

func (m sessionMeta) UpdatedAtColumn() database.Column {
	return database.NewColumn(m.tableName, "updated_at")
}

func (m sessionMeta) qualifiedTableName() string { return m.tableName }

var (
	_ domain.SessionRepository = (*SessionRepository)(nil)
	_ updatable                = (*sessionMeta)(nil)
	_ deletable                = (*sessionMeta)(nil)
)

// SessionRepository implements [domain.SessionRepository].
type SessionRepository struct {
	meta              sessionMeta
	SessionsTable     string
	UserAgentsTable   string
	ChecksTable       string
	AuthAttemptsTable string
	tokenRepo         domain.TokenRepository
	now               database.Instruction
	encodeUserAgent   func(info []byte) any
	isSpanner         bool
	pool              database.QueryExecutor
}

// NewSessionRepository returns a dialect-specific [SessionRepository].
func NewSessionRepository(pool database.QueryExecutor) *SessionRepository {
	switch pool.(type) {
	case spanner.SpannerPooler:
		return &SessionRepository{
			meta:              sessionMeta{tableName: spannerTableSessions},
			SessionsTable:     spannerTableSessions,
			UserAgentsTable:   spannerTableUserAgents,
			ChecksTable:       spannerTableChecks,
			AuthAttemptsTable: spannerTableAuthAttempts,
			tokenRepo:         NewTokenRepository(pool),
			now:               database.CurrentTimestampInstruction,
			encodeUserAgent:   func(b []byte) any { return string(b) },
			isSpanner:         true,
			pool:              pool,
		}
	case postgres.PostgresPooler:
		return &SessionRepository{
			meta:              sessionMeta{tableName: pgTableSessions},
			SessionsTable:     pgTableSessions,
			UserAgentsTable:   pgTableUserAgents,
			ChecksTable:       pgTableChecks,
			AuthAttemptsTable: pgTableAuthAttempts,
			tokenRepo:         NewTokenRepository(pool),
			now:               database.NowInstruction,
			encodeUserAgent:   func(b []byte) any { return b },
			isSpanner:         false,
			pool:              pool,
		}
	}
	panic("NewSessionRepository: unsupported pool type")
}

func hashHandoffToken(plain string) []byte {
	sum := sha256.Sum256([]byte(plain))
	return sum[:]
}

func withTransaction(ctx context.Context, q database.QueryExecutor, fn func(ctx context.Context, tx database.QueryExecutor) error) error {
	beginner, ok := q.(database.Beginner)
	if !ok {
		return fn(ctx, q)
	}
	tx, err := beginner.Begin(ctx, nil)
	if err != nil {
		return err
	}
	err = fn(ctx, tx)
	return tx.End(ctx, err)
}

// Create implements [domain.SessionRepository].
func (r *SessionRepository) Create(ctx context.Context, q database.QueryExecutor, session *domain.Session) error {
	return r.insertSession(ctx, q, session)
}

// Get implements [domain.SessionRepository].
func (r *SessionRepository) Get(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) (*domain.Session, error) {
	sessions, err := r.querySessions(ctx, q, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	if len(sessions) == 0 {
		return nil, domain.ErrSessionNotFound()
	}
	return sessions[0], nil
}

// List implements [domain.SessionRepository].
func (r *SessionRepository) List(ctx context.Context, q database.QueryExecutor, projectID string) ([]*domain.Session, error) {
	sessions, err := r.querySessions(ctx, q, projectID, "")
	if err != nil {
		return nil, err
	}
	if sessions == nil {
		return []*domain.Session{}, nil
	}
	return sessions, nil
}

// Delete implements [domain.SessionRepository].
func (r *SessionRepository) Delete(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) error {
	cond := database.And(
		database.NewTextCondition(database.NewColumn(r.meta.tableName, "project_id"), database.TextOperationEqual, projectID),
		database.NewTextCondition(database.NewColumn(r.meta.tableName, "id"), database.TextOperationEqual, database.Identity(sessionID)),
	)
	n, err := deleteOne(ctx, q, &r.meta, cond)
	if err != nil {
		return err
	}
	if n == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

// Exchange implements [domain.SessionRepository].
func (r *SessionRepository) Exchange(ctx context.Context, q database.QueryExecutor, projectID, handoffToken string, _ *string, ttl time.Duration) (*domain.Session, error) {
	var result *domain.Session
	err := withTransaction(ctx, q, func(ctx context.Context, tx database.QueryExecutor) (err error) {
		result, err = r.exchange(ctx, tx, projectID, handoffToken, ttl)
		return err
	})
	return result, err
}

func (r *SessionRepository) appendSessionSelect(b *database.StatementBuilder) {
	b.WriteString("SELECT s.project_id, s.id, s.created_at, s.updated_at, s.expires_at, s.time_to_live, s.token_id, s.user_id,")
	b.WriteString(" ua.id, ua.info,")
	b.WriteString(" c.type, c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload")
	b.WriteString(" FROM ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" s LEFT JOIN ")
	b.WriteString(r.UserAgentsTable)
	b.WriteString(" ua ON s.project_id = ua.project_id AND s.user_agent_id = ua.id LEFT JOIN ")
	b.WriteString(r.ChecksTable)
	b.WriteString(" c ON c.project_id = s.project_id AND c.session_id = s.id")
}

func (r *SessionRepository) appendSessionWhere(b *database.StatementBuilder, projectID, sessionID string) {
	b.WriteString(" WHERE s.project_id = ")
	b.WriteArg(projectID)
	if sessionID != "" {
		b.WriteString(" AND s.id = ")
		b.WriteArg(database.Identity(sessionID))
	}
}

func (r *SessionRepository) buildSessionListQuery(projectID, sessionID string) *database.StatementBuilder {
	b := database.NewStatementBuilder("")
	r.appendSessionSelect(b)
	r.appendSessionWhere(b, projectID, sessionID)
	b.WriteString(" ORDER BY s.id")
	return b
}

func (r *SessionRepository) querySessions(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) ([]*domain.Session, error) {
	b := r.buildSessionListQuery(projectID, sessionID)
	rows, err := q.Query(ctx, b.String(), b.Args()...)
	if err != nil {
		return nil, fmt.Errorf("failed to query sessions: %w", err)
	}
	defer rows.Close()
	return r.scanSessions(rows)
}

func (r *SessionRepository) buildInsertUserAgent(projectID string, info []byte) *database.StatementBuilder {
	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(r.UserAgentsTable)
	b.WriteString(" (project_id, info) VALUES (")
	b.WriteArg(projectID)
	b.WriteString(", ")
	b.WriteArg(r.encodeUserAgent(info))
	if r.isSpanner {
		b.WriteString(") THEN RETURN id")
	} else {
		b.WriteString(") RETURNING id")
	}
	return b
}

func (r *SessionRepository) buildInsertSessionPostgres(projectID string, userAgentID database.Identity, ttl time.Duration) *database.StatementBuilder {
	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" (project_id, user_agent_id, time_to_live, token_id) VALUES (")
	b.WriteArg(projectID)
	b.WriteString(", ")
	b.WriteArg(userAgentID)
	b.WriteString(", ")
	b.WriteArg(ttl)
	b.WriteString("::INTERVAL, 0) RETURNING id, created_at, updated_at, expires_at")
	return b
}

func (r *SessionRepository) buildUpdateSessionTokenID(projectID string, sessionID, tokenID database.Identity) *database.StatementBuilder {
	b := database.NewStatementBuilder("UPDATE ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" SET token_id = ")
	b.WriteArg(tokenID)
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND id = ")
	b.WriteArg(sessionID)
	return b
}

func shouldRevokePreviousToken(previousTokenID string) bool {
	return previousTokenID != "" && previousTokenID != "0"
}

func (r *SessionRepository) createSessionToken(ctx context.Context, q database.QueryExecutor, session *domain.Session, previousTokenID string) error {
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
	if err := r.tokenRepo.Create(ctx, q, tok); err != nil {
		return fmt.Errorf("failed to create session token: %w", err)
	}

	updateB := r.buildUpdateSessionTokenID(session.ProjectID, database.Identity(session.ID), database.Identity(tok.TokenID))
	if _, err := q.Exec(ctx, updateB.String(), updateB.Args()...); err != nil {
		return fmt.Errorf("failed to set session token_id: %w", err)
	}
	session.TokenID = tok.TokenID

	if shouldRevokePreviousToken(previousTokenID) {
		if err := r.tokenRepo.Delete(ctx, q, r.tokenRepo.PrimaryKeyCondition(session.ProjectID, previousTokenID)); err != nil {
			return fmt.Errorf("failed to revoke previous session token: %w", err)
		}
	}
	return nil
}

func (r *SessionRepository) buildInsertSessionSpanner(projectID string, userAgentID database.Identity, ttl time.Duration) *database.StatementBuilder {
	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(r.meta.tableName)
	b.WriteString(" (project_id, user_agent_id, time_to_live, token_id, created_at, updated_at) VALUES (")
	b.WriteArg(projectID)
	b.WriteString(", ")
	b.WriteArg(userAgentID)
	b.WriteString(", ")
	b.WriteArg(ttl.Nanoseconds())
	b.WriteString(", 0, ")
	b.WriteArg(r.now)
	b.WriteString(", ")
	b.WriteArg(r.now)
	b.WriteString(") THEN RETURN id, created_at, updated_at, expires_at")
	return b
}

func (r *SessionRepository) sessionTTLChange(ttl time.Duration) database.Change {
	if r.isSpanner {
		return database.NewChange(database.NewColumn(r.meta.tableName, "time_to_live"), ttl.Nanoseconds())
	}
	return database.NewChange(database.NewColumn(r.meta.tableName, "time_to_live"), ttl)
}

func (r *SessionRepository) buildLoadAttemptChecks(projectID, attemptID string) *database.StatementBuilder {
	b := database.NewStatementBuilder("SELECT id, type, last_verified_at FROM ")
	b.WriteString(r.ChecksTable)
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND auth_attempt_id = ")
	b.WriteArg(database.Identity(attemptID))
	b.WriteString(" AND last_verified_at IS NOT NULL")
	return b
}

func (r *SessionRepository) buildLoadSessionChecks(projectID, sessionID string) *database.StatementBuilder {
	b := database.NewStatementBuilder("SELECT id, type, last_verified_at FROM ")
	b.WriteString(r.ChecksTable)
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND session_id = ")
	b.WriteArg(database.Identity(sessionID))
	b.WriteString(" AND last_verified_at IS NOT NULL")
	return b
}

func (r *SessionRepository) buildSelectFactorPayload(projectID, checkID string) *database.StatementBuilder {
	b := database.NewStatementBuilder("SELECT factor_payload FROM ")
	b.WriteString(r.ChecksTable)
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND id = ")
	b.WriteArg(database.Identity(checkID))
	return b
}

func (r *SessionRepository) buildPromoteCheck(sessionID, projectID string, checkID database.Identity) *database.StatementBuilder {
	b := database.NewStatementBuilder("UPDATE ")
	b.WriteString(r.ChecksTable)
	b.WriteString(" SET session_id = ")
	b.WriteArg(database.Identity(sessionID))
	b.WriteString(", auth_attempt_id = NULL, challenge_payload = NULL, last_challenged_at = NULL, last_failed_at = NULL, failure_count = 0")
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND id = ")
	b.WriteArg(checkID)
	b.WriteString(" AND auth_attempt_id IS NOT NULL")
	return b
}

func (r *SessionRepository) buildDeleteSessionCheckLoser(projectID, sessionID string, typ domain.AuthCheckType, winnerID string) *database.StatementBuilder {
	b := database.NewStatementBuilder("DELETE FROM ")
	b.WriteString(r.ChecksTable)
	b.WriteString(" WHERE project_id = ")
	b.WriteArg(projectID)
	b.WriteString(" AND session_id = ")
	b.WriteArg(database.Identity(sessionID))
	b.WriteString(" AND type = ")
	b.WriteArg(typ)
	b.WriteString(" AND id <> ")
	b.WriteArg(database.Identity(winnerID))
	return b
}

func userAgentFromStoredInfo(info map[string]any) *domain.UserAgent {
	ua := &domain.UserAgent{Info: info}
	if ip, ok := info["ip"].(string); ok {
		ua.IP = ip
	}
	if fingerprint, ok := info[userAgentFingerprintKey].(string); ok {
		ua.ID = fingerprint
	}
	return ua
}

func (r *SessionRepository) scanSessions(rows database.Rows) ([]*domain.Session, error) {
	byID := make(map[string]*domain.Session)
	order := make([]string, 0)

	for rows.Next() {
		var (
			projectID        string
			sessionID        database.Identity
			createdAt        time.Time
			updatedAt        time.Time
			expiresAt        time.Time
			tokenID          database.Identity
			userID           database.Null[string]
			userAgentID      database.Null[int64]
			userAgentInfo    JSON[json.RawMessage]
			checkType        database.Null[int64]
			checkID          database.Identity
			checkIDValid     bool
			lastChallengedAt database.Null[time.Time]
			lastVerifiedAt   database.Null[time.Time]
			lastFailedAt     database.Null[time.Time]
			failureCount     database.Null[uint16]
			challenge        JSON[json.RawMessage]
			factor           JSON[json.RawMessage]
		)

		var timeToLive time.Duration
		var timeToLiveNanos int64
		var scanArgs []any
		if r.isSpanner {
			scanArgs = []any{
				&projectID, &sessionID, &createdAt, &updatedAt, &expiresAt, &timeToLiveNanos, &tokenID, &userID,
				&userAgentID, &userAgentInfo,
				&checkType, &checkID, &lastChallengedAt, &lastVerifiedAt, &lastFailedAt, &failureCount, &challenge, &factor,
			}
		} else {
			scanArgs = []any{
				&projectID, &sessionID, &createdAt, &updatedAt, &expiresAt, &timeToLive, &tokenID, &userID,
				&userAgentID, &userAgentInfo,
				&checkType, &checkID, &lastChallengedAt, &lastVerifiedAt, &lastFailedAt, &failureCount, &challenge, &factor,
			}
		}
		if err := rows.Scan(scanArgs...); err != nil {
			return nil, fmt.Errorf("failed to scan session row: %w", err)
		}
		if r.isSpanner {
			timeToLive = time.Duration(timeToLiveNanos)
		}
		checkIDValid = checkID.String() != ""

		id := sessionID.String()
		session, ok := byID[id]
		if !ok {
			session = &domain.Session{
				ProjectID:  projectID,
				ID:         id,
				CreatedAt:  createdAt,
				UpdatedAt:  updatedAt,
				ExpiresAt:  expiresAt,
				TimeToLive: timeToLive,
				TokenID:    tokenID.String(),
			}
			if userID.Valid {
				session.UserID = &userID.V
			}
			if userAgentID.Valid {
				info := map[string]any{}
				if len(userAgentInfo.Value) > 0 {
					if err := json.Unmarshal(userAgentInfo.Value, &info); err != nil {
						return nil, fmt.Errorf("failed to unmarshal user agent info: %w", err)
					}
				}
				session.UserAgent = userAgentFromStoredInfo(info)
			}
			byID[id] = session
			order = append(order, id)
		}

		if !checkType.Valid || !checkIDValid {
			continue
		}
		checks, err := newAuthChecks(
			domain.AuthCheckType(checkType.V),
			checkID.String(),
			lastChallengedAt.V,
			lastFailedAt.V,
			lastVerifiedAt.V,
			failureCount.V,
			challenge.Value,
			factor.Value,
		)
		if err != nil {
			return nil, err
		}
		for _, check := range checks {
			if factor, ok := check.(domain.AuthFactor); ok {
				appendSessionFactor(session, factor)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]*domain.Session, 0, len(order))
	for _, id := range order {
		session := byID[id]
		session.State = deriveSessionState(session, time.Now())
		out = append(out, session)
	}
	return out, nil
}

func deriveSessionState(session *domain.Session, now time.Time) domain.SessionState {
	if now.After(session.ExpiresAt) {
		return domain.SessionStateExpired
	}
	for _, factor := range session.Factors {
		if factor.Type() != domain.AuthCheckTypeUser && !factor.GetLastVerifiedAt().IsZero() {
			return domain.SessionStateActive
		}
	}
	return domain.SessionStateBuilding
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

type storedCheck struct {
	ID             string
	Type           domain.AuthCheckType
	LastVerifiedAt time.Time
	OnAttempt      bool
}

func (r *SessionRepository) insertSession(ctx context.Context, q database.QueryExecutor, session *domain.Session) error {
	if session.TimeToLive <= 0 {
		session.TimeToLive = domain.SessionAnonymousTTL
	}

	var userAgentID database.Identity
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
		b := r.buildInsertUserAgent(session.ProjectID, raw)
		err = q.QueryRow(ctx, b.String(), b.Args()...).Scan(&userAgentID)
		if err != nil {
			return fmt.Errorf("failed to insert user agent: %w", err)
		}
	}

	if r.isSpanner {
		return r.insertSessionSpanner(ctx, q, session, userAgentID)
	}
	return r.insertSessionPostgres(ctx, q, session, userAgentID)
}

func (r *SessionRepository) insertSessionPostgres(ctx context.Context, q database.QueryExecutor, session *domain.Session, userAgentID database.Identity) error {
	return withTransaction(ctx, q, func(ctx context.Context, tx database.QueryExecutor) error {
		var (
			sessionID database.Identity
			createdAt time.Time
			updatedAt time.Time
			expiresAt time.Time
		)
		insertB := r.buildInsertSessionPostgres(session.ProjectID, userAgentID, session.TimeToLive)
		err := tx.QueryRow(ctx, insertB.String(), insertB.Args()...).Scan(&sessionID, &createdAt, &updatedAt, &expiresAt)
		if err != nil {
			return fmt.Errorf("failed to insert session: %w", err)
		}
		session.ID = sessionID.String()
		session.CreatedAt = createdAt
		session.UpdatedAt = updatedAt
		session.ExpiresAt = expiresAt
		return r.createSessionToken(ctx, tx, session, "")
	})
}

func (r *SessionRepository) insertSessionSpanner(ctx context.Context, q database.QueryExecutor, session *domain.Session, userAgentID database.Identity) error {
	return withTransaction(ctx, q, func(ctx context.Context, tx database.QueryExecutor) error {
		var sessionID database.Identity
		insertB := r.buildInsertSessionSpanner(session.ProjectID, userAgentID, session.TimeToLive)
		err := tx.QueryRow(ctx, insertB.String(), insertB.Args()...).Scan(&sessionID, &session.CreatedAt, &session.UpdatedAt, &session.ExpiresAt)
		if err != nil {
			return fmt.Errorf("failed to insert session: %w", err)
		}
		session.ID = sessionID.String()
		return r.createSessionToken(ctx, tx, session, "")
	})
}

func (r *SessionRepository) exchange(ctx context.Context, q database.QueryExecutor, projectID, handoffToken string, ttl time.Duration) (*domain.Session, error) {
	attemptRepo := NewAuthAttemptRepository(r.pool)
	attempt, err := attemptRepo.GetByHandoffToken(ctx, q, projectID, hashHandoffToken(handoffToken))
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
		targetSession, err = r.Get(ctx, q, projectID, *attempt.SessionID)
		if err != nil {
			if errors.Is(err, domain.ErrSessionNotFound()) {
				return nil, domain.ErrSessionExchangeConflict()
			}
			return nil, err
		}
	} else {
		targetSession = &domain.Session{
			ProjectID:  projectID,
			TimeToLive: exchangeTTL(ttl),
		}
		if err := r.insertSession(ctx, q, targetSession); err != nil {
			return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
		}
	}

	attemptChecks, err := r.loadAttemptChecks(ctx, q, projectID, attempt.ID)
	if err != nil {
		return nil, err
	}
	sessionChecks, err := r.loadSessionChecks(ctx, q, projectID, targetSession.ID)
	if err != nil {
		return nil, err
	}

	lastVerifiedChecks := pickLastVerifiedChecksByType(attemptChecks, sessionChecks)
	if err := r.applyExchange(ctx, q, projectID, targetSession.ID, lastVerifiedChecks); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}

	userID, err := r.userIDFromLastVerifiedChecks(ctx, q, projectID, lastVerifiedChecks)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	oldTokenID := targetSession.TokenID
	if userID != nil {
		targetSession.UserID = userID
	}
	changes := []database.Change{
		database.NewChange(database.NewColumn(r.meta.tableName, "updated_at"), r.now),
	}
	if userID != nil {
		changes = append(changes, database.NewChange(database.NewColumn(r.meta.tableName, "user_id"), userID))
	}
	if ttl > 0 {
		changes = append(changes, r.sessionTTLChange(ttl))
	}
	cond := database.And(
		database.NewTextCondition(database.NewColumn(r.meta.tableName, "project_id"), database.TextOperationEqual, projectID),
		database.NewTextCondition(database.NewColumn(r.meta.tableName, "id"), database.TextOperationEqual, targetSession.ID),
	)
	if _, err := updateOne(ctx, q, &r.meta, cond, changes...); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}

	if err := attemptRepo.Delete(ctx, q, projectID, attempt.ID); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}

	refreshed, err := r.Get(ctx, q, projectID, targetSession.ID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	if err := r.createSessionToken(ctx, q, refreshed, oldTokenID); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}
	return refreshed, nil
}

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

func (r *SessionRepository) loadAttemptChecks(ctx context.Context, q database.QueryExecutor, projectID, attemptID string) ([]storedCheck, error) {
	b := r.buildLoadAttemptChecks(projectID, attemptID)
	rows, err := q.Query(ctx, b.String(), b.Args()...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStoredChecks(rows, true)
}

func (r *SessionRepository) loadSessionChecks(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) ([]storedCheck, error) {
	b := r.buildLoadSessionChecks(projectID, sessionID)
	rows, err := q.Query(ctx, b.String(), b.Args()...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStoredChecks(rows, false)
}

func scanStoredChecks(rows database.Rows, onAttempt bool) ([]storedCheck, error) {
	var out []storedCheck
	for rows.Next() {
		var (
			id             database.Identity
			typ            int64
			lastVerifiedAt time.Time
		)
		if err := rows.Scan(&id, &typ, &lastVerifiedAt); err != nil {
			return nil, err
		}
		out = append(out, storedCheck{
			ID:             id.String(),
			Type:           domain.AuthCheckType(typ),
			LastVerifiedAt: lastVerifiedAt,
			OnAttempt:      onAttempt,
		})
	}
	return out, rows.Err()
}

// pickLastVerifiedChecksByType keeps at most one check per type, preferring the most recent last_verified_at.
func pickLastVerifiedChecksByType(attemptChecks, sessionChecks []storedCheck) map[domain.AuthCheckType]storedCheck {
	lastVerifiedChecks := make(map[domain.AuthCheckType]storedCheck)
	for _, c := range sessionChecks {
		lastVerifiedChecks[c.Type] = c
	}
	for _, c := range attemptChecks {
		existing, ok := lastVerifiedChecks[c.Type]
		if !ok || c.LastVerifiedAt.After(existing.LastVerifiedAt) {
			lastVerifiedChecks[c.Type] = c
		}
	}
	return lastVerifiedChecks
}

func (r *SessionRepository) applyExchange(ctx context.Context, q database.QueryExecutor, projectID, sessionID string, lastVerifiedChecks map[domain.AuthCheckType]storedCheck) error {
	if len(lastVerifiedChecks) == 0 {
		return nil
	}

	promoteIDs := make([]database.Identity, 0, len(lastVerifiedChecks))
	for _, c := range lastVerifiedChecks {
		if c.OnAttempt {
			promoteIDs = append(promoteIDs, database.Identity(c.ID))
		}
	}

	if len(promoteIDs) > 0 {
		for _, id := range promoteIDs {
			b := r.buildPromoteCheck(sessionID, projectID, id)
			n, err := q.Exec(ctx, b.String(), b.Args()...)
			if err != nil {
				return err
			}
			if n == 0 {
				return fmt.Errorf("failed to promote check %s", id)
			}
		}
	}

	for _, c := range lastVerifiedChecks {
		b := r.buildDeleteSessionCheckLoser(projectID, sessionID, c.Type, c.ID)
		if _, err := q.Exec(ctx, b.String(), b.Args()...); err != nil {
			return err
		}
	}

	return nil
}

func (r *SessionRepository) userIDFromLastVerifiedChecks(ctx context.Context, q database.QueryExecutor, projectID string, lastVerifiedChecks map[domain.AuthCheckType]storedCheck) (*string, error) {
	w, ok := lastVerifiedChecks[domain.AuthCheckTypeUser]
	if !ok {
		return nil, nil
	}
	var factor JSON[json.RawMessage]
	b := r.buildSelectFactorPayload(projectID, w.ID)
	err := q.QueryRow(ctx, b.String(), b.Args()...).Scan(&factor)
	if err != nil {
		return nil, fmt.Errorf("failed to load user factor payload: %w", err)
	}
	var payload domain.AuthFactorUser
	if len(factor.Value) > 0 {
		if err := json.Unmarshal(factor.Value, &payload); err != nil {
			return nil, fmt.Errorf("failed to unmarshal user factor payload: %w", err)
		}
	}
	if payload.UserID == "" {
		return nil, nil
	}
	return &payload.UserID, nil
}
