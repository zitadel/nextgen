package repository

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

const (
	pgTableSessions    = "zitadel_nextgen.sessions"
	pgTableUserAgents  = "zitadel_nextgen.user_agents"
	pgTableChecks      = "zitadel_nextgen.checks"
	pgTableAuthAttempts = "zitadel_nextgen.auth_attempts"

	spannerTableSessions     = "sessions"
	spannerTableUserAgents   = "user_agents"
	spannerTableChecks       = "checks"
	spannerTableAuthAttempts = "auth_attempts"
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
	_ domain.SessionRepository = (*sessionRepository)(nil)
	_ updatable                = (*sessionMeta)(nil)
	_ deletable                = (*sessionMeta)(nil)
)

type sessionRepository struct {
	meta              sessionMeta
	userAgentsTable   string
	checksTable       string
	authAttemptsTable string
	now               database.Instruction
	encodeUserAgent   func(info []byte) any
	isSpanner         bool
	pool              database.QueryExecutor
}

// NewSessionRepository returns a dialect-specific implementation of [domain.SessionRepository].
func NewSessionRepository(pool database.QueryExecutor) domain.SessionRepository {
	switch pool.(type) {
	case spanner.SpannerPooler:
		return &sessionRepository{
			meta:              sessionMeta{tableName: spannerTableSessions},
			userAgentsTable:   spannerTableUserAgents,
			checksTable:       spannerTableChecks,
			authAttemptsTable: spannerTableAuthAttempts,
			now:               database.CurrentTimestampInstruction,
			encodeUserAgent:   func(b []byte) any { return string(b) },
			isSpanner:         true,
			pool:              pool,
		}
	case postgres.PostgresPooler:
		return &sessionRepository{
			meta:              sessionMeta{tableName: pgTableSessions},
			userAgentsTable:   pgTableUserAgents,
			checksTable:       pgTableChecks,
			authAttemptsTable: pgTableAuthAttempts,
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

func (r *sessionRepository) Create(ctx context.Context, q database.QueryExecutor, session *domain.Session) error {
	return r.insertSession(ctx, q, session)
}

func (r *sessionRepository) Get(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) (*domain.Session, error) {
	sessions, err := r.querySessions(ctx, q, projectID, sessionID)
	if err != nil {
		return nil, err
	}
	if len(sessions) == 0 {
		return nil, domain.ErrSessionNotFound()
	}
	return sessions[0], nil
}

func (r *sessionRepository) List(ctx context.Context, q database.QueryExecutor, projectID string) ([]*domain.Session, error) {
	sessions, err := r.querySessions(ctx, q, projectID, "")
	if err != nil {
		return nil, err
	}
	if sessions == nil {
		return []*domain.Session{}, nil
	}
	return sessions, nil
}

func (r *sessionRepository) Delete(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) error {
	cond := database.And(
		database.NewTextCondition(database.NewColumn(r.meta.tableName, "project_id"), database.TextOperationEqual, projectID),
		database.NewTextCondition(database.NewColumn(r.meta.tableName, "id"), database.TextOperationEqual, sessionID),
	)
	n, err := deleteOne[*sessionMeta](ctx, q, &r.meta, cond)
	if err != nil {
		return err
	}
	if n == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

func (r *sessionRepository) Exchange(ctx context.Context, q database.QueryExecutor, projectID, handoffToken string, _ *string, ttl time.Duration) (*domain.Session, error) {
	var result *domain.Session
	err := withTransaction(ctx, q, func(ctx context.Context, tx database.QueryExecutor) error {
		var err error
		result, err = r.exchange(ctx, tx, projectID, handoffToken, ttl)
		return err
	})
	return result, err
}

func (r *sessionRepository) sessionSelect(whereClause string) string {
	return `SELECT s.project_id, s.id, s.created_at, s.updated_at, s.expires_at, s.token_id, s.user_id,` +
		` ua.id, ua.info,` +
		` c.type, c.id, c.last_challenged_at, c.last_verified_at, c.last_failed_at, c.failure_count, c.challenge_payload, c.factor_payload` +
		` FROM ` + r.meta.tableName + ` s` +
		` LEFT JOIN ` + r.userAgentsTable + ` ua ON s.project_id = ua.project_id AND s.user_agent_id = ua.id` +
		` LEFT JOIN ` + r.checksTable + ` c ON c.project_id = s.project_id AND c.session_id = s.id` +
		whereClause
}

func (r *sessionRepository) querySessions(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) ([]*domain.Session, error) {
	query := r.sessionSelect(` WHERE s.project_id = $1`)
	args := []any{projectID}
	if sessionID != "" {
		query += ` AND s.id = $2`
		args = append(args, database.Identity(sessionID))
	}
	query += ` ORDER BY s.id`

	rows, err := q.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query sessions: %w", err)
	}
	defer rows.Close()
	return scanSessions(rows)
}

func scanSessions(rows database.Rows) ([]*domain.Session, error) {
	byID := make(map[string]*domain.Session)
	order := make([]string, 0)

	for rows.Next() {
		var (
			projectID        string
			sessionID        database.Identity
			createdAt        time.Time
			updatedAt        time.Time
			expiresAt        database.Null[time.Time]
			tokenID          database.Identity
			userID           database.Null[string]
			userAgentID      database.Null[int64]
			userAgentInfo    json.RawMessage
			checkType        database.Null[int64]
			checkID          database.Identity
			checkIDValid     bool
			lastChallengedAt database.Null[time.Time]
			lastVerifiedAt   database.Null[time.Time]
			lastFailedAt     database.Null[time.Time]
			failureCount     database.Null[uint16]
			challenge        json.RawMessage
			factor           json.RawMessage
		)

		if err := rows.Scan(
			&projectID, &sessionID, &createdAt, &updatedAt, &expiresAt, &tokenID, &userID,
			&userAgentID, &userAgentInfo,
			&checkType, &checkID, &lastChallengedAt, &lastVerifiedAt, &lastFailedAt, &failureCount, &challenge, &factor,
		); err != nil {
			return nil, fmt.Errorf("failed to scan session row: %w", err)
		}
		checkIDValid = checkID.String() != ""

		id := sessionID.String()
		sess, ok := byID[id]
		if !ok {
			sess = &domain.Session{
				ProjectID: projectID,
				ID:        id,
				CreatedAt: createdAt,
				UpdatedAt: updatedAt,
				TokenID:   tokenID.String(),
			}
			if expiresAt.Valid {
				sess.ExpiresAt = expiresAt.V
				sess.TimeToLive = expiresAt.V.Sub(updatedAt)
			}
			if userID.Valid {
				sess.UserID = &userID.V
			}
			if userAgentID.Valid {
				info := map[string]any{}
				if len(userAgentInfo) > 0 {
					_ = json.Unmarshal(userAgentInfo, &info)
				}
				ua := &domain.UserAgent{
					ID:   strconv.FormatInt(userAgentID.V, 10),
					Info: info,
				}
				if ip, ok := info["ip"].(string); ok {
					ua.IP = ip
				}
				sess.UserAgent = ua
			}
			byID[id] = sess
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
			challenge,
			factor,
		)
		if err != nil {
			return nil, err
		}
		for _, check := range checks {
			if factor, ok := check.(domain.AuthFactor); ok {
				appendSessionFactor(sess, factor)
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

func appendSessionFactor(sess *domain.Session, factor domain.AuthFactor) {
	for i, f := range sess.Factors {
		if f.Type() == factor.Type() {
			sess.Factors[i] = factor
			return
		}
	}
	sess.Factors = append(sess.Factors, factor)
}

type storedCheck struct {
	ID             string
	Type           domain.AuthCheckType
	LastVerifiedAt time.Time
	OnAttempt      bool
}

func (r *sessionRepository) insertSession(ctx context.Context, q database.QueryExecutor, session *domain.Session) error {
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
		raw, err := json.Marshal(info)
		if err != nil {
			return fmt.Errorf("failed to marshal user agent info: %w", err)
		}
		err = q.QueryRow(ctx,
			`INSERT INTO `+r.userAgentsTable+` (project_id, info) VALUES ($1, $2) RETURNING id`,
			session.ProjectID, r.encodeUserAgent(raw),
		).Scan(&userAgentID)
		if err != nil {
			return fmt.Errorf("failed to insert user agent: %w", err)
		}
		session.UserAgent.ID = userAgentID.String()
	}

	if r.isSpanner {
		return r.insertSessionSpanner(ctx, q, session, userAgentID)
	}
	return r.insertSessionPostgres(ctx, q, session, userAgentID)
}

func (r *sessionRepository) insertSessionPostgres(ctx context.Context, q database.QueryExecutor, session *domain.Session, userAgentID database.Identity) error {
	expiresAt := time.Now().UTC().Add(session.TimeToLive)
	var (
		sessionID database.Identity
		createdAt time.Time
		updatedAt time.Time
	)
	err := q.QueryRow(ctx,
		`INSERT INTO `+r.meta.tableName+` (project_id, user_agent_id, expires_at, token_id)`+
			` VALUES ($1, $2, $3, 0) RETURNING id, created_at, updated_at`,
		session.ProjectID, userAgentID, expiresAt,
	).Scan(&sessionID, &createdAt, &updatedAt)
	if err != nil {
		return fmt.Errorf("failed to insert session: %w", err)
	}
	_, err = q.Exec(ctx,
		`UPDATE `+r.meta.tableName+` SET token_id = id WHERE project_id = $1 AND id = $2`,
		session.ProjectID, sessionID,
	)
	if err != nil {
		return fmt.Errorf("failed to set session token_id: %w", err)
	}
	session.ID = sessionID.String()
	session.TokenID = session.ID
	session.CreatedAt = createdAt
	session.UpdatedAt = updatedAt
	session.ExpiresAt = expiresAt
	session.TimeToLive = expiresAt.Sub(createdAt)
	return nil
}

func (r *sessionRepository) insertSessionSpanner(ctx context.Context, q database.QueryExecutor, session *domain.Session, userAgentID database.Identity) error {
	expiresAt := time.Now().UTC().Add(session.TimeToLive)
	var sessionID database.Identity
	err := q.QueryRow(ctx,
		`INSERT INTO `+r.meta.tableName+` (project_id, user_agent_id, expires_at, token_id, created_at, updated_at)`+
			` VALUES ($1, $2, $3, 0, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()) THEN RETURN id, created_at, updated_at`,
		session.ProjectID, userAgentID, expiresAt,
	).Scan(&sessionID, &session.CreatedAt, &session.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to insert session: %w", err)
	}
	_, err = q.Exec(ctx,
		`UPDATE `+r.meta.tableName+` SET token_id = $1 WHERE project_id = $2 AND id = $3`,
		sessionID, session.ProjectID, sessionID,
	)
	if err != nil {
		return fmt.Errorf("failed to set session token_id: %w", err)
	}
	session.ID = sessionID.String()
	session.TokenID = session.ID
	session.ExpiresAt = expiresAt
	return nil
}

func (r *sessionRepository) exchange(ctx context.Context, q database.QueryExecutor, projectID, handoffToken string, ttl time.Duration) (*domain.Session, error) {
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

	winners := pickCheckWinners(attemptChecks, sessionChecks)
	if err := r.applyExchange(ctx, q, projectID, targetSession.ID, winners); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}

	userID := r.userIDFromWinners(ctx, q, projectID, winners)
	changes := []database.Change{
		database.NewChange(database.NewColumn(r.meta.tableName, "updated_at"), r.now),
	}
	if userID != nil {
		changes = append(changes, database.NewChange(database.NewColumn(r.meta.tableName, "user_id"), userID))
	}
	if ttl > 0 {
		changes = append(changes, database.NewChange(database.NewColumn(r.meta.tableName, "expires_at"), time.Now().UTC().Add(ttl)))
	}
	cond := database.And(
		database.NewTextCondition(database.NewColumn(r.meta.tableName, "project_id"), database.TextOperationEqual, projectID),
		database.NewTextCondition(database.NewColumn(r.meta.tableName, "id"), database.TextOperationEqual, targetSession.ID),
	)
	if _, err := updateOne[*sessionMeta](ctx, q, &r.meta, cond, changes...); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}

	if err := attemptRepo.Delete(ctx, q, projectID, attempt.ID); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrSessionExchangeConflict(), err)
	}

	return r.Get(ctx, q, projectID, targetSession.ID)
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

func (r *sessionRepository) loadAttemptChecks(ctx context.Context, q database.QueryExecutor, projectID, attemptID string) ([]storedCheck, error) {
	rows, err := q.Query(ctx,
		`SELECT id, type, last_verified_at FROM `+r.checksTable+
			` WHERE project_id = $1 AND auth_attempt_id = $2 AND last_verified_at IS NOT NULL`,
		projectID, database.Identity(attemptID),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStoredChecks(rows, true)
}

func (r *sessionRepository) loadSessionChecks(ctx context.Context, q database.QueryExecutor, projectID, sessionID string) ([]storedCheck, error) {
	rows, err := q.Query(ctx,
		`SELECT id, type, last_verified_at FROM `+r.checksTable+
			` WHERE project_id = $1 AND session_id = $2`,
		projectID, database.Identity(sessionID),
	)
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

// pickCheckWinners keeps at most one check per type, preferring the most recent last_verified_at.
func pickCheckWinners(attemptChecks, sessionChecks []storedCheck) map[domain.AuthCheckType]storedCheck {
	winners := make(map[domain.AuthCheckType]storedCheck)
	for _, c := range sessionChecks {
		winners[c.Type] = c
	}
	for _, c := range attemptChecks {
		existing, ok := winners[c.Type]
		if !ok || c.LastVerifiedAt.After(existing.LastVerifiedAt) {
			winners[c.Type] = c
		}
	}
	return winners
}

func (r *sessionRepository) applyExchange(ctx context.Context, q database.QueryExecutor, projectID, sessionID string, winners map[domain.AuthCheckType]storedCheck) error {
	if len(winners) == 0 {
		return nil
	}

	promoteIDs := make([]database.Identity, 0, len(winners))
	for _, w := range winners {
		if w.OnAttempt {
			promoteIDs = append(promoteIDs, database.Identity(w.ID))
		}
	}

	if len(promoteIDs) > 0 {
		for _, id := range promoteIDs {
			n, err := q.Exec(ctx,
				`UPDATE `+r.checksTable+
					` SET session_id = $1, auth_attempt_id = NULL, challenge_payload = NULL, last_challenged_at = NULL, last_failed_at = NULL, failure_count = 0`+
					` WHERE project_id = $2 AND id = $3 AND auth_attempt_id IS NOT NULL`,
				database.Identity(sessionID), projectID, id,
			)
			if err != nil {
				return err
			}
			if n == 0 {
				return fmt.Errorf("failed to promote check %s", id)
			}
		}
	}

	// Remove session-scoped checks that lost their type to a newer winner.
	for _, w := range winners {
		_, err := q.Exec(ctx,
			`DELETE FROM `+r.checksTable+
				` WHERE project_id = $1 AND session_id = $2 AND type = $3 AND id <> $4`,
			projectID, database.Identity(sessionID), w.Type, database.Identity(w.ID),
		)
		if err != nil {
			return err
		}
	}

	return nil
}

func (r *sessionRepository) userIDFromWinners(ctx context.Context, q database.QueryExecutor, projectID string, winners map[domain.AuthCheckType]storedCheck) *string {
	w, ok := winners[domain.AuthCheckTypeUser]
	if !ok {
		return nil
	}
	var factor json.RawMessage
	err := q.QueryRow(ctx,
		`SELECT factor_payload FROM `+r.checksTable+` WHERE project_id = $1 AND id = $2`,
		projectID, database.Identity(w.ID),
	).Scan(&factor)
	if err != nil {
		return nil
	}
	var payload domain.AuthFactorUser
	if len(factor) > 0 {
		if err := json.Unmarshal(factor, &payload); err != nil {
			return nil
		}
	}
	if payload.UserID == "" {
		return nil
	}
	return &payload.UserID
}
