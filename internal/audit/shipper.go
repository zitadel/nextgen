package audit

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

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

func DefaultExportConfig() ExportConfig {
	return ExportConfig{
		Enabled:  false,
		Interval: 5 * time.Second,
		Sinks:    nil,
	}
}

// EventExportSource backs the shipper with claimed projects and sink cursors.
type EventExportSource interface {
	ListClaimedProjectIDs(ctx context.Context) ([]string, error)
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

// Shipper delivers events to deployment-configured sinks (ADR 049).
type Shipper struct {
	cfg    ExportConfig
	src    EventExportSource
	client *http.Client
	sinks  []*domain.EventSink
	stop   chan struct{}
	done   chan struct{}
}

func NewShipper(src EventExportSource, cfg ExportConfig) *Shipper {
	if cfg.Interval <= 0 {
		cfg.Interval = DefaultExportConfig().Interval
	}
	return &Shipper{
		cfg:    cfg,
		src:    src,
		client: &http.Client{Timeout: 10 * time.Second},
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
	}
}

func (s *Shipper) Start(ctx context.Context) error {
	if !s.cfg.Enabled {
		close(s.done)
		return nil
	}
	for _, sc := range s.cfg.Sinks {
		if sc.Type == "" {
			continue
		}
		switch sc.Type {
		case domain.EventSinkTypeStdout, domain.EventSinkTypeWebhook:
		default:
			close(s.done)
			return fmt.Errorf("unsupported event sink type %q", sc.Type)
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
			close(s.done)
			return err
		}
		s.sinks = append(s.sinks, sink)
	}
	go s.loop()
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

func (s *Shipper) shipOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), shipListTimeout)
	projects, err := s.src.ListClaimedProjectIDs(ctx)
	cancel()
	if err != nil {
		slog.Error("event shipper: list claimed projects failed",
			slog.String("error", err.Error()),
		)
		return
	}
	for _, sink := range s.sinks {
		for _, projectID := range projects {
			s.shipProject(sink, projectID)
		}
	}
}

func (s *Shipper) shipProject(sink *domain.EventSink, projectID string) {
	ctx, cancel := context.WithTimeout(context.Background(), shipProjectTimeout)
	defer cancel()

	cursor, err := s.src.GetEventSinkCursor(ctx, sink.ID, projectID)
	if err != nil {
		slog.Error("event shipper: get cursor failed",
			slog.String("sink_id", sink.ID),
			slog.String("project_id", projectID),
			slog.String("error", err.Error()),
		)
		return
	}
	if cursor == nil {
		cursor = &domain.EventSinkCursor{
			SinkID:    sink.ID,
			ProjectID: projectID,
		}
	}

	for {
		if err := ctx.Err(); err != nil {
			return
		}
		batch, err := s.src.ListEventsAfterCursor(ctx, projectID, cursor.LastCreatedAt, cursor.LastEventID, shipPageSize)
		if err != nil {
			slog.Error("event shipper: list after cursor failed",
				slog.String("sink_id", sink.ID),
				slog.String("project_id", projectID),
				slog.String("error", err.Error()),
			)
			return
		}
		if len(batch) == 0 {
			return
		}
		var last *domain.Event
		for _, ev := range batch {
			if err := s.deliver(ctx, sink, ev); err != nil {
				slog.Error("event shipper: deliver failed",
					slog.String("sink_id", sink.ID),
					slog.String("project_id", projectID),
					slog.String("event_id", ev.ID),
					slog.String("error", err.Error()),
				)
				s.upsertCursor(ctx, sink.ID, projectID, cursor, last)
				return
			}
			cursor.LastCreatedAt = ev.CreatedAt
			cursor.LastEventID = ev.ID
			last = ev
		}
		if !s.upsertCursor(ctx, sink.ID, projectID, cursor, last) {
			return
		}
		if len(batch) < shipPageSize {
			return
		}
	}
}

func (s *Shipper) upsertCursor(ctx context.Context, sinkID, projectID string, cursor *domain.EventSinkCursor, last *domain.Event) bool {
	if last == nil {
		return true
	}
	if err := s.src.UpsertEventSinkCursor(ctx, cursor); err != nil {
		slog.Error("event shipper: upsert cursor failed",
			slog.String("sink_id", sinkID),
			slog.String("project_id", projectID),
			slog.String("event_id", last.ID),
			slog.String("error", err.Error()),
		)
		return false
	}
	return true
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
