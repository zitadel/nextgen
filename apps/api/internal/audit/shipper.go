package audit

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"os"
	"slices"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/zitadel/nextgen/internal/background"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/events"
)

// SinkConfig is a deployment-configured event sink (no project CRUD in v1).
type SinkConfig struct {
	Type domain.EventSinkType `mapstructure:"type"`
	URL  string               `mapstructure:"url"`
	// Enabled is opt-out: a configured sink (non-empty type) ships unless this
	// is explicitly false.
	Enabled *bool `mapstructure:"enabled"`
}

func sinkEnabled(sc SinkConfig) bool {
	if sc.Enabled == nil {
		return true
	}
	return *sc.Enabled
}

// ExportConfig holds deployment-scoped sinks and shipper tuning.
type ExportConfig struct {
	Enabled  bool          `mapstructure:"enabled"`
	Interval time.Duration `mapstructure:"interval"`
	Sinks    []SinkConfig  `mapstructure:"sinks"`
}

// Validate refuses a sink of a type the shipper cannot deliver to.
func (c ExportConfig) Validate() error {
	for _, sink := range c.Sinks {
		if err := checkSinkType(sink.Type); err != nil {
			return fmt.Errorf("events.export.sinks: %w", err)
		}
	}
	return nil
}

func checkSinkType(sinkType domain.EventSinkType) error {
	switch sinkType {
	case "", domain.EventSinkTypeStdout, domain.EventSinkTypeWebhook:
		return nil
	}
	return fmt.Errorf("unsupported event sink type %q", sinkType)
}

func DefaultExportConfig() ExportConfig {
	return ExportConfig{
		Enabled:  false,
		Interval: 5 * time.Second,
		Sinks:    nil,
	}
}

// EventExportSource backs the shipper with the projects whose events ship and
// sink cursors. Every sink is deployment-scoped, the platform operators', who
// see every project's events, claimed or not (ADR 049 §4), so every project
// ships.
type EventExportSource interface {
	ListProjectIDs(ctx context.Context) ([]string, error)
	EnsureSink(ctx context.Context, sink *domain.EventSink) error
	GetEventSinkCursor(ctx context.Context, sinkID, projectID string) (*domain.EventSinkCursor, error)
	UpsertEventSinkCursor(ctx context.Context, cursor *domain.EventSinkCursor) error
	ListEventsAfterCursor(ctx context.Context, projectID string, afterCreatedAt time.Time, afterID string, limit int) ([]*domain.Event, error)
}

const (
	shipListTimeout    = 30 * time.Second
	shipProjectTimeout = 30 * time.Second
	shipPageSize       = 100
)

// Shipper delivers events to deployment-configured sinks (ADR 049): on its
// own timer, and once per call to the server's wake-up endpoint.
type Shipper struct {
	cfg    ExportConfig
	src    EventExportSource
	client *http.Client
	// sinks are the configured sinks once ensureSinks has registered them.
	sinksMu    sync.Mutex
	sinksReady bool
	sinks      []*domain.EventSink
	// shipping holds a token while a round runs, so the rounds of one
	// process run one after the other and deliver no event twice.
	shipping chan struct{}
	// firstProject picks where a woken round starts in a list of n projects.
	firstProject func(n int) int
	stop         chan struct{}
	done         chan struct{}
}

func NewShipper(src EventExportSource, cfg ExportConfig) *Shipper {
	if cfg.Interval <= 0 {
		cfg.Interval = DefaultExportConfig().Interval
	}
	return &Shipper{
		cfg: cfg,
		src: src,
		// Operator-configured URL, not user-injectable: stdlib client by design (ADR 061).
		//egress:allow operator-configured export sink, not user-injectable (ADR 061)
		client:       &http.Client{Timeout: 10 * time.Second},
		shipping:     make(chan struct{}, 1),
		firstProject: rand.IntN,
		stop:         make(chan struct{}),
		done:         make(chan struct{}),
	}
}

// Task is the shipper as background work. Where instances come and go it
// ships while one is up, from the cursor the last one stored. A process
// paused between requests runs no timer, so there it ships only when the
// server is woken: what is pending since the last call, in one round.
func (s *Shipper) Task() background.Task {
	return background.Task{
		Name:        "event export",
		Disabled:    !s.cfg.Enabled,
		Start:       s.Start,
		Stop:        s.Close,
		Once:        s.Once,
		ScaleToZero: background.WhileUp(),
		RequestOnly: background.OnWakeUp("turn the export off with events.export.enabled"),
	}
}

func (s *Shipper) Start(ctx context.Context) error {
	if !s.cfg.Enabled {
		close(s.done)
		return nil
	}
	if err := s.ensureSinks(ctx); err != nil {
		close(s.done)
		return err
	}
	if len(s.sinks) == 0 {
		close(s.done)
		return nil
	}
	go s.loop() //background:allow the task "event export"
	return nil
}

// ensureSinks registers the configured sinks, once per process: as the
// shipper starts where its loop runs, and in the first round where only a
// wake-up runs it, so that a start there costs no statement.
func (s *Shipper) ensureSinks(ctx context.Context) error {
	s.sinksMu.Lock()
	defer s.sinksMu.Unlock()
	if s.sinksReady {
		return nil
	}
	var sinks []*domain.EventSink
	for _, sc := range s.cfg.Sinks {
		if sc.Type == "" {
			continue
		}
		if err := checkSinkType(sc.Type); err != nil {
			return err
		}
		if !sinkEnabled(sc) {
			continue
		}
		sink := &domain.EventSink{
			Type:    sc.Type,
			Scope:   domain.EventSinkScopeDeployment,
			URL:     sc.URL,
			Enabled: true,
		}
		if err := s.src.EnsureSink(ctx, sink); err != nil {
			return err
		}
		sinks = append(sinks, sink)
	}
	s.sinks = sinks
	s.sinksReady = true
	return nil
}

func (s *Shipper) loop() {
	defer close(s.done)
	ticker := time.NewTicker(s.cfg.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			s.shipOnce()
		}
	}
}

// shipOnce is the loop's round. Its failures are logged where they happen.
func (s *Shipper) shipOnce() {
	_ = s.ship(context.Background(), nil)
}

// Once ships one round for a caller that waits for it, such as a call to the
// wake-up endpoint. ctx bounds the round: what it leaves, the next round
// ships. It starts at a project picked at random, so that a round a deadline
// cuts short does not leave the same projects waiting every time.
func (s *Shipper) Once(ctx context.Context) error {
	if err := s.ensureSinks(ctx); err != nil {
		return err
	}
	return s.ship(ctx, s.firstProject)
}

// ship ships every project to every sink, each pair from its own cursor, and
// waits for a round this process is already running. first, when set, picks
// the project the round starts with. The error counts the pairs that failed
// and carries the first failure.
func (s *Shipper) ship(ctx context.Context, first func(n int) int) error {
	select {
	case s.shipping <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { <-s.shipping }()

	projects, err := s.listProjects(ctx)
	if err != nil {
		slog.Error("event shipper: list projects failed",
			slog.String("error", err.Error()),
		)
		return err
	}
	if first != nil && len(projects) > 1 {
		from := first(len(projects))
		projects = slices.Concat(projects[from:], projects[:from])
	}
	var (
		failed  int
		failure error
	)
	for _, sink := range s.sinks {
		for _, projectID := range projects {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := s.shipProject(ctx, sink, projectID); err != nil {
				failed++
				if failure == nil {
					failure = err
				}
			}
		}
	}
	if failure != nil {
		return fmt.Errorf("%d of %d shipments failed, the first: %w", failed, len(s.sinks)*len(projects), failure)
	}
	return nil
}

// listProjects lists the projects to ship under a job span of its own, ended
// before any project is shipped.
func (s *Shipper) listProjects(ctx context.Context) ([]string, error) {
	ctx, span := startJobSpan(ctx, "audit.ListProjects")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, shipListTimeout)
	defer cancel()
	projects, err := s.src.ListProjectIDs(ctx)
	if err != nil {
		failJobSpan(ctx, err)
	}
	return projects, err
}

// shipProject ships one project to one sink under its own job span, so a
// trace covers one pair rather than a whole round. It logs what failed and
// returns it.
func (s *Shipper) shipProject(ctx context.Context, sink *domain.EventSink, projectID string) error {
	ctx, span := startJobSpan(ctx, "audit.ShipEvents",
		attribute.String("zitadel.event_sink.id", sink.ID),
		attribute.String("zitadel.project.id", projectID),
	)
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, shipProjectTimeout)
	defer cancel()

	cursor, err := s.src.GetEventSinkCursor(ctx, sink.ID, projectID)
	if err != nil {
		failJobSpan(ctx, err)
		slog.Error("event shipper: get cursor failed",
			slog.String("sink_id", sink.ID),
			slog.String("project_id", projectID),
			slog.String("error", err.Error()),
		)
		return err
	}
	if cursor == nil {
		cursor = &domain.EventSinkCursor{
			SinkID:    sink.ID,
			ProjectID: projectID,
		}
	}

	for {
		if err := ctx.Err(); err != nil {
			failJobSpan(ctx, err)
			return err
		}
		batch, err := s.src.ListEventsAfterCursor(ctx, projectID, cursor.LastCreatedAt, cursor.LastEventID, shipPageSize)
		if err != nil {
			failJobSpan(ctx, err)
			slog.Error("event shipper: list after cursor failed",
				slog.String("sink_id", sink.ID),
				slog.String("project_id", projectID),
				slog.String("error", err.Error()),
			)
			return err
		}
		if len(batch) == 0 {
			return nil
		}
		var last *domain.Event
		for _, ev := range batch {
			if err := s.deliver(ctx, sink, ev); err != nil {
				failJobSpan(ctx, err)
				slog.Error("event shipper: deliver failed",
					slog.String("sink_id", sink.ID),
					slog.String("project_id", projectID),
					slog.String("event_id", ev.ID),
					slog.String("error", err.Error()),
				)
				_ = s.upsertCursor(ctx, sink.ID, projectID, cursor, last)
				return err
			}
			cursor.LastCreatedAt = ev.CreatedAt
			cursor.LastEventID = ev.ID
			last = ev
		}
		if err := s.upsertCursor(ctx, sink.ID, projectID, cursor, last); err != nil {
			return err
		}
		if len(batch) < shipPageSize {
			return nil
		}
	}
}

// upsertCursor stores the cursor when the page delivered an event. It logs a
// failure to store it and returns it.
func (s *Shipper) upsertCursor(ctx context.Context, sinkID, projectID string, cursor *domain.EventSinkCursor, last *domain.Event) error {
	if last == nil {
		return nil
	}
	if err := s.src.UpsertEventSinkCursor(ctx, cursor); err != nil {
		failJobSpan(ctx, err)
		slog.Error("event shipper: upsert cursor failed",
			slog.String("sink_id", sinkID),
			slog.String("project_id", projectID),
			slog.String("event_id", last.ID),
			slog.String("error", err.Error()),
		)
		return err
	}
	return nil
}

func (s *Shipper) deliver(ctx context.Context, sink *domain.EventSink, ev *domain.Event) error {
	body, err := events.MarshalWire(ev)
	if err != nil {
		return err
	}
	switch sink.Type {
	case domain.EventSinkTypeStdout:
		_, err := io.Copy(os.Stdout, bytes.NewReader(append(body, '\n')))
		return err
	case domain.EventSinkTypeWebhook:
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, sink.URL, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := s.client.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		_, _ = io.Copy(io.Discard, resp.Body)
		if resp.StatusCode >= 300 {
			return &httpError{status: resp.StatusCode}
		}
		return nil
	default:
		return fmt.Errorf("unsupported event sink type %q", sink.Type)
	}
}

type httpError struct{ status int }

func (e *httpError) Error() string { return http.StatusText(e.status) }

func (s *Shipper) Close() {
	select {
	case <-s.stop:
	default:
		close(s.stop)
	}
	<-s.done
}
