package repository

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

const sessionsTable = "zitadel_nextgen.sessions"

var (
	sessionColProjectID   = database.NewColumn(sessionsTable, "project_id")
	sessionColID          = database.NewColumn(sessionsTable, "id")
	sessionColCreatedAt   = database.NewColumn(sessionsTable, "created_at")
	sessionColUpdatedAt   = database.NewColumn(sessionsTable, "updated_at")
	sessionColExpiresAt   = database.NewColumn(sessionsTable, "expires_at")
	sessionColToken       = database.NewColumn(sessionsTable, "token")
	sessionColUserID      = database.NewColumn(sessionsTable, "user_id")
	sessionColUserAgentID = database.NewColumn(sessionsTable, "user_agent_id")
)

type sessionMeta struct {
	table string
	now   database.Instruction
}

type sessionRepository struct {
	meta         sessionMeta
	exec         database.QueryExecutor
	beginner     database.Beginner
	authAttempts domain.AuthAttemptRepository
	userAgents   *UserAgentRepository
	flusher      credentialFailureFlusher
}

var _ domain.SessionRepository = (*sessionRepository)(nil)

// NewSessionRepository returns a [domain.SessionRepository] backed by the given pool.
func NewSessionRepository(pool database.Pool, authAttempts domain.AuthAttemptRepository) domain.SessionRepository {
	return newSessionRepository(pool, pool, authAttempts)
}

// NewSessionRepositoryForTest is like [NewSessionRepository] but uses exec for CRUD (for example a test transaction).
func NewSessionRepositoryForTest(exec database.QueryExecutor, beginner database.Beginner, authAttempts domain.AuthAttemptRepository) domain.SessionRepository {
	return newSessionRepository(exec, beginner, authAttempts)
}

// newSessionRepository builds a session repository. exec runs statements; beginner starts transactions (MergeAttempt).
func newSessionRepository(exec database.QueryExecutor, beginner database.Beginner, authAttempts domain.AuthAttemptRepository) domain.SessionRepository {
	flusher := credentialFailureFlusher{
		passwords: NewUserPasswordRepository(),
		totp:      NewUserTOTPRepository(),
		recovery:  NewUserRecoveryCodesRepository(),
	}
	switch exec.(type) {
	case spanner.SpannerPooler:
		return &sessionRepository{
			meta:         sessionMeta{table: "sessions", now: database.CurrentTimestampInstruction},
			exec:         exec,
			beginner:     beginner,
			authAttempts: authAttempts,
			userAgents:   NewUserAgentRepository(exec),
			flusher:      flusher,
		}
	case postgres.PostgresPooler:
		return &sessionRepository{
			meta:         sessionMeta{table: sessionsTable, now: database.NowInstruction},
			exec:         exec,
			beginner:     beginner,
			authAttempts: authAttempts,
			userAgents:   NewUserAgentRepository(exec),
			flusher:      flusher,
		}
	}
	panic("newSessionRepository: unsupported executor type")
}

func (r *sessionRepository) Create(ctx context.Context, session *domain.Session) error {
	if session == nil {
		return fmt.Errorf("failed to create session: session is required")
	}
	if session.ProjectID == "" || session.ID == "" || session.Token == "" {
		return fmt.Errorf("failed to create session: project id, id, and token are required")
	}

	if session.UserAgent != nil && session.UserAgent.ID != "" {
		if err := r.userAgents.Create(ctx, r.exec, session.UserAgent, session.ProjectID); err != nil {
			return fmt.Errorf("failed to create session: %w", err)
		}
	}

	var userAgentID *string
	if session.UserAgent != nil && session.UserAgent.ID != "" {
		userAgentID = &session.UserAgent.ID
	}

	var userID *string
	if session.UserID != nil {
		userID = session.UserID
	}

	var expires any
	if !session.ExpiresAt.IsZero() {
		expires = session.ExpiresAt
	}

	b := database.NewStatementBuilder("INSERT INTO ")
	b.WriteString(r.meta.table)
	b.WriteString(" (project_id, id, token, user_id, user_agent_id, expires_at, created_at, updated_at) VALUES (")
	b.WriteArgs(session.ProjectID, session.ID, session.Token, userID, userAgentID, expires, r.meta.now, r.meta.now)
	b.WriteString(") RETURNING created_at, updated_at")
	err := r.exec.QueryRow(ctx, b.String(), b.Args()...).Scan(&session.CreatedAt, &session.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	return nil
}

func (r *sessionRepository) GetByID(ctx context.Context, projectID, sessionID string) (*domain.Session, error) {
	return r.get(ctx, r.exec, ` WHERE project_id = $1 AND id = $2`, projectID, sessionID)
}

func (r *sessionRepository) GetByToken(ctx context.Context, projectID, token string) (*domain.Session, error) {
	return r.get(ctx, r.exec, ` WHERE project_id = $1 AND token = $2`, projectID, token)
}

func (r *sessionRepository) List(ctx context.Context, opts ...database.QueryOption) ([]*domain.Session, error) {
	builder := database.NewStatementBuilder(`SELECT project_id, id, created_at, updated_at, expires_at, token, user_id, user_agent_id FROM ` + r.meta.table)
	queryOpts := &database.QueryOpts{}
	for _, opt := range opts {
		opt(queryOpts)
	}
	queryOpts.Write(builder)

	rows, err := r.exec.Query(ctx, builder.String(), builder.Args()...)
	if err != nil {
		return nil, fmt.Errorf("failed to query sessions: %w", err)
	}
	defer rows.Close()

	var sessions []*domain.Session
	for rows.Next() {
		s, userAgentID, err := r.scanSessionRow(rows)
		if err != nil {
			return nil, err
		}
		if userAgentID.Valid {
			agent, err := r.userAgents.GetByID(ctx, r.exec, s.ProjectID, userAgentID.V)
			if err != nil {
				return nil, fmt.Errorf("failed to load user agent: %w", err)
			}
			s.UserAgent = agent
		}
		if err := r.loadSessionChecks(ctx, r.exec, s); err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

func (r *sessionRepository) Delete(ctx context.Context, projectID, sessionID string) error {
	condition := database.And(
		database.NewTextCondition(sessionColProjectID, database.TextOperationEqual, projectID),
		database.NewTextCondition(sessionColID, database.TextOperationEqual, sessionID),
	)
	_, err := deleteOne(ctx, r.exec, sessionTableAdapter{table: r.meta.table}, condition)
	if err != nil {
		return fmt.Errorf("failed to delete session: %w", err)
	}
	return nil
}

func (r *sessionRepository) MergeAttempt(ctx context.Context, projectID, sessionID, handoffToken string) (*domain.Session, error) {
	tx, err := r.beginner.Begin(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to merge attempt: %w", err)
	}
	defer func() { _ = tx.End(ctx, err) }()

	attempt, err := r.authAttempts.GetByHandoffToken(ctx, tx, projectID, handoffToken)
	if err != nil {
		return nil, fmt.Errorf("failed to merge attempt: %w", err)
	}
	if attempt.ID == "" {
		return nil, fmt.Errorf("failed to merge attempt: auth attempt not found")
	}
	if attempt.HandedOffAt == nil {
		return nil, fmt.Errorf("failed to merge attempt: auth attempt not handed off")
	}
	if attempt.SessionID != nil && *attempt.SessionID != sessionID {
		return nil, fmt.Errorf("failed to merge attempt: session id mismatch")
	}

	session, err := r.get(ctx, tx, ` WHERE project_id = $1 AND id = $2`, projectID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to merge attempt: %w", err)
	}
	if session.ID == "" {
		return nil, fmt.Errorf("failed to merge attempt: session not found")
	}

	checks, err := listAttemptChecks(ctx, tx, projectID, attempt.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to merge attempt: %w", err)
	}

	hasSucceeded := false
	for _, c := range checks {
		if err := r.flusher.flush(ctx, tx, c); err != nil {
			return nil, fmt.Errorf("failed to merge attempt: flush credential failures: %w", err)
		}
		if c.Succeeded() {
			hasSucceeded = true
			if err := deleteSessionChecksForCredential(ctx, tx, projectID, sessionID, c); err != nil {
				return nil, fmt.Errorf("failed to merge attempt: %w", err)
			}
			if err := promoteCheckToSession(ctx, tx, projectID, sessionID, c); err != nil {
				return nil, fmt.Errorf("failed to merge attempt: %w", err)
			}
		}
	}
	if !hasSucceeded {
		return nil, fmt.Errorf("failed to merge attempt: no succeeded checks")
	}

	for _, checker := range attempt.Checks {
		if userCheck, ok := checker.(*domain.UserAuthCheck); ok && userCheck.Factor != nil && userCheck.Factor.UserID != "" {
			uid := userCheck.Factor.UserID
			session.UserID = &uid
			break
		}
	}

	newToken, err := newSessionToken()
	if err != nil {
		return nil, err
	}

	var expires any
	if session.ExpiresAt.IsZero() {
		expires = time.Now().Add(24 * time.Hour).UTC()
	} else {
		expires = session.ExpiresAt
	}

	ub := database.NewStatementBuilder("UPDATE ")
	ub.WriteString(r.meta.table)
	ub.WriteString(" SET token = ")
	ub.WriteArg(newToken)
	ub.WriteString(", user_id = ")
	ub.WriteArg(session.UserID)
	ub.WriteString(", expires_at = ")
	ub.WriteArg(expires)
	ub.WriteString(", updated_at = ")
	ub.WriteArg(r.meta.now)
	ub.WriteString(" WHERE project_id = ")
	ub.WriteArg(projectID)
	ub.WriteString(" AND id = ")
	ub.WriteArg(sessionID)
	_, err = tx.Exec(ctx, ub.String(), ub.Args()...)
	if err != nil {
		return nil, fmt.Errorf("failed to merge attempt: update session: %w", err)
	}

	if err = r.authAttempts.Delete(ctx, tx, projectID, attempt.ID); err != nil {
		return nil, fmt.Errorf("failed to merge attempt: delete attempt: %w", err)
	}

	err = nil
	return r.get(ctx, tx, ` WHERE project_id = $1 AND id = $2`, projectID, sessionID)
}

func (r *sessionRepository) get(ctx context.Context, client database.QueryExecutor, whereClause, projectID, matcher string) (*domain.Session, error) {
	rows, err := client.Query(ctx,
		`SELECT project_id, id, created_at, updated_at, expires_at, token, user_id, user_agent_id FROM `+r.meta.table+whereClause,
		projectID, matcher)
	if err != nil {
		return nil, fmt.Errorf("failed to query session: %w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		return &domain.Session{}, rows.Err()
	}
	s, userAgentID, err := r.scanSessionRow(rows)
	if err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if userAgentID.Valid {
		agent, err := r.userAgents.GetByID(ctx, client, s.ProjectID, userAgentID.V)
		if err != nil {
			return nil, fmt.Errorf("failed to load user agent: %w", err)
		}
		s.UserAgent = agent
	}
	if err := r.loadSessionChecks(ctx, client, s); err != nil {
		return nil, err
	}
	return s, nil
}

func (r *sessionRepository) scanSessionRow(rows database.Rows) (*domain.Session, database.Null[string], error) {
	var (
		expiresAt   database.Null[time.Time]
		userID      database.Null[string]
		userAgentID database.Null[string]
	)
	s := new(domain.Session)
	if err := rows.Scan(
		&s.ProjectID, &s.ID, &s.CreatedAt, &s.UpdatedAt, &expiresAt, &s.Token, &userID, &userAgentID,
	); err != nil {
		return nil, userAgentID, fmt.Errorf("failed to scan session: %w", err)
	}
	if expiresAt.Valid {
		s.ExpiresAt = expiresAt.V
	}
	if userID.Valid {
		s.UserID = &userID.V
	}
	return s, userAgentID, nil
}

func (r *sessionRepository) loadSessionChecks(ctx context.Context, client database.QueryExecutor, s *domain.Session) error {
	checks, err := loadSessionChecks(ctx, client, s.ProjectID, s.ID)
	if err != nil {
		return fmt.Errorf("failed to load session checks: %w", err)
	}
	s.Factors = checksToSessionFactors(checks)
	return nil
}

func newSessionToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate session token: %w", err)
	}
	return "stok_" + hex.EncodeToString(b), nil
}

type sessionTableAdapter struct{ table string }

func (a sessionTableAdapter) qualifiedTableName() string { return a.table }

func (sessionTableAdapter) PrimaryKeyColumns() []database.Column {
	return []database.Column{sessionColProjectID, sessionColID}
}

func (sessionTableAdapter) UpdatedAtColumn() database.Column { return sessionColUpdatedAt }

func (r *sessionRepository) ProjectIDColumn() database.Column   { return sessionColProjectID }
func (r *sessionRepository) IDColumn() database.Column          { return sessionColID }
func (r *sessionRepository) CreatedAtColumn() database.Column { return sessionColCreatedAt }
func (r *sessionRepository) UpdatedAtColumn() database.Column { return sessionColUpdatedAt }
func (r *sessionRepository) ExpiresAtColumn() database.Column { return sessionColExpiresAt }
func (r *sessionRepository) TokenColumn() database.Column     { return sessionColToken }
func (r *sessionRepository) UserIDColumn() database.Column    { return sessionColUserID }
func (r *sessionRepository) UserAgentIDColumn() database.Column {
	return sessionColUserAgentID
}

func (r *sessionRepository) ProjectIDCondition(projectID string) database.Condition {
	return database.NewTextCondition(sessionColProjectID, database.TextOperationEqual, projectID)
}

func (r *sessionRepository) IDCondition(sessionID string) database.Condition {
	return database.NewTextCondition(sessionColID, database.TextOperationEqual, sessionID)
}

func (r *sessionRepository) UserIDCondition(userID string) database.Condition {
	return database.NewTextCondition(sessionColUserID, database.TextOperationEqual, userID)
}

func (r *sessionRepository) IsExpiredCondition() database.Condition {
	return database.And(
		database.NewNumberCondition(sessionColExpiresAt, database.NumberOperationLessThan, database.NowInstruction),
		database.IsNotNull(sessionColExpiresAt),
	)
}
