package audit

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
)

// UsageConfig controls the usage projector (ADR 085).
type UsageConfig struct {
	Enabled  bool          `mapstructure:"enabled"`
	Interval time.Duration `mapstructure:"interval"`
	// TriggerSecret hands the schedule to something outside the process, as
	// RetentionConfig.TriggerSecret does: set, the server runs no loop and
	// counts once per request to UsageTriggerPath that carries it as a
	// bearer token.
	TriggerSecret string `mapstructure:"trigger_secret"`
}

// Validate refuses a trigger secret the purge's trigger would refuse.
func (c UsageConfig) Validate() error {
	if c.TriggerSecret == "" {
		return nil
	}
	if err := CheckTriggerSecret(c.TriggerSecret); err != nil {
		return fmt.Errorf("usage.trigger_secret %w", err)
	}
	return nil
}

// UsageTriggerPath is where a scheduler starts one count when the config
// names a trigger secret. Like RetentionTriggerPath it is the deployment
// operator's, outside the API.
const UsageTriggerPath = "/cron/usage"

func DefaultUsageConfig() UsageConfig {
	return UsageConfig{Enabled: true, Interval: 5 * time.Minute}
}

// UsageStore is what the projector counts with (service.UsageStore).
type UsageStore interface {
	// ListProjectIDs lists every project, claimed or not.
	ListProjectIDs(ctx context.Context) ([]string, error)
	GetUsageCursor(ctx context.Context, projectID string) (*domain.UsageCursor, error)
	ReadUsageEvents(ctx context.Context, projectID string, after *domain.UsageCursor, types []domain.EventType, limit uint32) ([]*domain.Event, time.Time, error)
	// CountUsage moves the cursor from prev to next and counts the touches
	// the meters have not counted yet, in one transaction. It reports false,
	// counting nothing, when another run moved the cursor first.
	CountUsage(ctx context.Context, prev *domain.UsageCursor, next domain.UsageCursor, touches []domain.UsageTouch) (bool, error)
}

// usageBatchLimit is how many events one transaction counts.
const usageBatchLimit = 500

const usageCloseTimeout = 5 * time.Second

// usageTriggerTimeout bounds a count that a request starts, as
// retentionTriggerTimeout does a purge.
const usageTriggerTimeout = 4*time.Minute + 30*time.Second

// UsageProjector counts the meters' events into the usage rollups: on its
// own timer, or once per request to its trigger when the config names a
// trigger secret. A project's events count once whatever runs at the same
// time, in this process or another: each batch moves the project's cursor
// in the transaction that counts it.
type UsageProjector struct {
	cfg       UsageConfig
	store     UsageStore
	types     []domain.EventType
	stop      chan struct{}
	done      chan struct{}
	runMu     sync.Mutex
	runCancel context.CancelFunc
	// counting holds a token while a run counts, so the runs of one process
	// count one after the other.
	counting chan struct{}
}

func NewUsageProjector(store UsageStore, cfg UsageConfig) *UsageProjector {
	if cfg.Interval <= 0 {
		cfg.Interval = DefaultUsageConfig().Interval
	}
	var types []domain.EventType
	for _, meter := range domain.UsageMeters {
		for _, eventType := range meter.EventTypes {
			if !slices.Contains(types, eventType) {
				types = append(types, eventType)
			}
		}
	}
	return &UsageProjector{
		cfg:      cfg,
		store:    store,
		types:    types,
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
		counting: make(chan struct{}, 1),
	}
}

// Start starts the loop, unless counting is off or a trigger runs it.
func (p *UsageProjector) Start() {
	if !p.cfg.Enabled || p.cfg.TriggerSecret != "" {
		close(p.done)
		return
	}
	go p.loop()
}

func (p *UsageProjector) loop() {
	defer close(p.done)
	ticker := time.NewTicker(p.cfg.Interval)
	defer ticker.Stop()
	p.runOnce()
	for {
		select {
		case <-p.stop:
			return
		case <-ticker.C:
			p.runOnce()
		}
	}
}

func (p *UsageProjector) runOnce() {
	ctx, span := startJobSpan(context.Background(), "audit.CountUsage")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	p.runMu.Lock()
	p.runCancel = cancel
	p.runMu.Unlock()
	defer func() {
		cancel()
		p.runMu.Lock()
		p.runCancel = nil
		p.runMu.Unlock()
	}()

	run, err := p.Count(ctx)
	if err != nil {
		failJobSpan(ctx, err)
		slog.Error("usage: count failed", slog.String("error", err.Error()))
		return
	}
	if run.Events > 0 {
		slog.Info("usage: counted events", run.attrs()...)
	}
}

// UsageRun is what one run counted.
type UsageRun struct {
	Projects int
	Events   int
}

func (r UsageRun) attrs() []any {
	return []any{slog.Int("projects", r.Projects), slog.Int("events", r.Events)}
}

// Count counts every project's new events once. A run waits for the one
// this process is running; one that another process runs at the same time
// counts what the other leaves, or nothing.
func (p *UsageProjector) Count(ctx context.Context) (UsageRun, error) {
	select {
	case p.counting <- struct{}{}:
	case <-ctx.Done():
		return UsageRun{}, ctx.Err()
	}
	defer func() { <-p.counting }()

	projectIDs, err := p.store.ListProjectIDs(ctx)
	if err != nil {
		return UsageRun{}, err
	}
	var run UsageRun
	for _, projectID := range projectIDs {
		events, err := p.countProject(ctx, projectID)
		if err != nil {
			return run, fmt.Errorf("project %s: %w", projectID, err)
		}
		run.Projects++
		run.Events += events
	}
	return run, nil
}

// countProject counts the project's events after its cursor, a batch per
// transaction, and returns how many it counted.
func (p *UsageProjector) countProject(ctx context.Context, projectID string) (int, error) {
	var counted int
	for {
		prev, err := p.store.GetUsageCursor(ctx, projectID)
		if err != nil {
			return counted, err
		}
		batch, bound, err := p.store.ReadUsageEvents(ctx, projectID, prev, p.types, usageBatchLimit)
		if err != nil {
			return counted, err
		}
		next, ok := nextUsageCursor(projectID, prev, batch, bound)
		if !ok {
			return counted, nil
		}
		moved, err := p.store.CountUsage(ctx, prev, next, usageTouches(batch))
		if err != nil || !moved {
			// Not moved: another run counts this project now, this batch too.
			return counted, err
		}
		counted += len(batch)
		if len(batch) < usageBatchLimit {
			return counted, nil
		}
	}
}

// nextUsageCursor is where the cursor moves after batch, and false when it
// stays.
//
//   - A full batch may leave events stamped at its last one's instant, so
//     the cursor moves onto that event.
//   - A short batch holds every event stamped before the bound, so the
//     cursor moves to the bound. A quiet project then never reads the
//     request events behind its last sign-in again.
//   - The cursor never moves back: a later read can see an earlier bound
//     while a writer is in flight.
//   - With nothing new, it moves only when the bound enters another hour,
//     which seals the hour before (ADR 085 §4): about one write per idle
//     project and hour.
func nextUsageCursor(projectID string, prev *domain.UsageCursor, batch []*domain.Event, bound time.Time) (domain.UsageCursor, bool) {
	if len(batch) == usageBatchLimit {
		last := batch[len(batch)-1]
		return domain.UsageCursor{ProjectID: projectID, CountedBefore: last.CreatedAt, LastEventID: last.ID}, true
	}
	next := domain.UsageCursor{ProjectID: projectID, CountedBefore: bound}
	if prev == nil {
		return next, true
	}
	if !bound.After(prev.CountedBefore) {
		return domain.UsageCursor{}, false
	}
	if len(batch) == 0 && domain.UsageHourOf(bound).Equal(domain.UsageHourOf(prev.CountedBefore)) {
		return domain.UsageCursor{}, false
	}
	return next, true
}

// usageTouches is every user the batch names for each meter, in the hour of
// their first event in the batch. The batch is oldest first.
func usageTouches(batch []*domain.Event) []domain.UsageTouch {
	type key struct {
		meter, user string
		month       time.Time
	}
	seen := make(map[key]bool)
	var touches []domain.UsageTouch
	for _, event := range batch {
		for _, meter := range domain.UsageMeters {
			if !slices.Contains(meter.EventTypes, event.EventType) {
				continue
			}
			user := meter.User(event)
			if user == "" {
				continue
			}
			k := key{meter: meter.Name, user: user, month: domain.UsageMonth(event.CreatedAt)}
			if seen[k] {
				continue
			}
			seen[k] = true
			touches = append(touches, domain.UsageTouch{
				Meter: meter.Name, Month: k.month, UserID: user, Hour: domain.UsageHourOf(event.CreatedAt),
			})
		}
	}
	return touches
}

// Trigger is the handler that counts once per GET or POST that carries the
// trigger secret as a bearer token, and answers what it counted. It is nil
// unless counting is on and the config names a trigger secret.
func (p *UsageProjector) Trigger() http.Handler {
	if !p.cfg.Enabled || p.cfg.TriggerSecret == "" {
		return nil
	}
	secret := sha256.Sum256([]byte(p.cfg.TriggerSecret))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			w.Header().Set("Allow", "GET, POST")
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		scheme, token, _ := strings.Cut(r.Header.Get("Authorization"), " ")
		sent := sha256.Sum256([]byte(token))
		if !strings.EqualFold(scheme, "Bearer") || subtle.ConstantTimeCompare(sent[:], secret[:]) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
			return
		}
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(usageTriggerTimeout + 10*time.Second))

		ctx, cancel := context.WithTimeout(r.Context(), usageTriggerTimeout)
		defer cancel()
		ctx, span := startJobSpan(ctx, "audit.CountUsage")
		defer span.End()

		run, err := p.Count(ctx)
		if err != nil {
			failJobSpan(ctx, err)
			zlog.Error(ctx, "usage: count failed", slog.String("error", err.Error()))
			http.Error(w, "usage: count failed", http.StatusInternalServerError)
			return
		}
		// Logged when nothing was counted too: every run leaves a line.
		zlog.Info(ctx, "usage: counted events", run.attrs()...)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = fmt.Fprintf(w, "{\"projects\":%d,\"events\":%d}\n", run.Projects, run.Events)
	})
}

func (p *UsageProjector) Close() {
	select {
	case <-p.stop:
	default:
		close(p.stop)
	}
	p.runMu.Lock()
	if p.runCancel != nil {
		p.runCancel()
	}
	p.runMu.Unlock()
	select {
	case <-p.done:
	case <-time.After(usageCloseTimeout):
		slog.Warn("usage: shutdown timed out")
	}
}
