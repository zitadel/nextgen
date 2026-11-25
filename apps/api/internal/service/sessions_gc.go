package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// JobNameSessionsGC is the periodic job that reaps expired sessions (#881).
const JobNameSessionsGC = "sessions.gc"

// SessionsGCConfig controls the sessions.gc sweeper (ADR 065).
type SessionsGCConfig struct {
	Enabled   bool          `mapstructure:"enabled"`
	Period    time.Duration `mapstructure:"period"`
	BatchSize int           `mapstructure:"batch_size"`
}

// DefaultSessionsGCConfig returns ADR 065 / plan defaults for sessions.gc.
func DefaultSessionsGCConfig() SessionsGCConfig {
	return SessionsGCConfig{
		Enabled:   true,
		Period:    time.Minute,
		BatchSize: 100,
	}
}

// ApplySessionsGCDefaults fills zero Period and BatchSize from defaults.
// Enabled is left as-is (viper SetDefault owns the boot default).
func ApplySessionsGCDefaults(cfg SessionsGCConfig) SessionsGCConfig {
	def := DefaultSessionsGCConfig()
	if cfg.Period <= 0 {
		cfg.Period = def.Period
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = def.BatchSize
	}
	return cfg
}

func (c SessionsGCConfig) Validate() error {
	if c.Period < 0 {
		return fmt.Errorf("session.gc.period must not be negative")
	}
	if c.BatchSize < 0 {
		return fmt.Errorf("session.gc.batch_size must not be negative")
	}
	return nil
}

// SessionsGC is the sessions.gc Perform handler: emit session.expired
// (system actor) then hard-delete, bounded per run.
//
// It does not import internal/jobs (jobs already imports service); the server
// wraps Perform as a jobs.Handler at RegisterWorker.
type SessionsGC struct {
	pool      StatementPool
	batchSize int
}

// NewSessionsGC builds a reaper that lists at most cfg.BatchSize expired
// sessions per Perform.
func NewSessionsGC(pool StatementPool, cfg SessionsGCConfig) *SessionsGC {
	cfg = ApplySessionsGCDefaults(cfg)
	return &SessionsGC{pool: pool, batchSize: cfg.BatchSize}
}

// Perform reaps up to batchSize sessions with expires_at < now.
// Idempotent under at-least-once: a missing session is a no-op.
func (g *SessionsGC) Perform(ctx context.Context) error {
	now := time.Now().UTC()
	listed, err := g.pool.Statements().ListSessions(ctx, &database.ListOptions[domain.SessionField]{
		Filter: database.LessThan(database.Col(domain.SessionFieldExpiresAt), now),
		Pagination: database.Page[domain.SessionField]{
			Limit: uint32(g.batchSize),
			OrderBy: database.OrderBy[domain.SessionField]{
				Columns: []database.Column[domain.SessionField]{
					database.Col(domain.SessionFieldExpiresAt),
					database.Col(domain.SessionFieldID),
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("sessions.gc list expired: %w", err)
	}
	for _, session := range listed.Items {
		if err := g.reapOne(ctx, session); err != nil {
			return err
		}
	}
	return nil
}

func (g *SessionsGC) reapOne(ctx context.Context, session *domain.Session) error {
	return g.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		current, err := stmts.GetSessionByID(ctx, session.ProjectID, session.ID)
		if err != nil {
			if errors.Is(err, domain.ErrSessionNotFound()) {
				return nil
			}
			return fmt.Errorf("sessions.gc get %s: %w", session.ID, err)
		}
		// Still live: another write extended TTL between list and take.
		if !current.ExpiresAt.Before(time.Now().UTC()) {
			return nil
		}
		if err := emitSessionExpired(ctx, stmts, current); err != nil {
			return err
		}
		if err := stmts.DeleteTokensBySessionID(ctx, current.ProjectID, current.ID); err != nil {
			return fmt.Errorf("sessions.gc delete tokens %s: %w", current.ID, err)
		}
		if err := stmts.DeleteSessionByID(ctx, current.ProjectID, current.ID); err != nil {
			if errors.Is(err, domain.ErrSessionNotFound()) {
				return nil
			}
			return fmt.Errorf("sessions.gc delete %s: %w", current.ID, err)
		}
		return nil
	})
}

func emitSessionExpired(ctx context.Context, stmts EventStatements, session *domain.Session) error {
	actorType := domain.EventActorTypeSystem
	sid := session.ID
	userID := ""
	if session.UserID != nil {
		userID = *session.UserID
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeSessionExpired,
		Category:   domain.EventCategorySession,
		ProjectID:  session.ProjectID,
		EntityType: "session",
		EntityID:   session.ID,
		UserID:     userID,
		SessionID:  &sid,
		ActorType:  &actorType,
		Payload:    domain.SessionExpiredPayload{},
	})
}
