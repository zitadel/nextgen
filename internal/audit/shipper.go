package audit

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/events"
)

// SinkConfig is a deployment-configured event sink (no project CRUD in v1).
type SinkConfig struct {
	Type    domain.EventSinkType `mapstructure:"type"`
	URL     string               `mapstructure:"url"`
	Enabled bool                 `mapstructure:"enabled"`
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
		cfg.Interval = 5 * time.Second
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
		// v1 always enables configured sink types (Enabled flag is reserved).
		sink := &domain.EventSink{
			ID:      deploymentSinkID(sc.Type, sc.URL),
			Type:    sc.Type,
			Scope:   domain.EventSinkScopeDeployment,
			URL:     sc.URL,
			Enabled: true,
		}
		if err := s.src.EnsureSink(ctx, sink); err != nil {
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
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	projects, err := s.src.ListClaimedProjectIDs(ctx)
	if err != nil {
		slog.Error("event shipper: list claimed projects failed",
			slog.String("error", err.Error()),
		)
		return
	}
	for _, sink := range s.sinks {
		for _, projectID := range projects {
			s.shipProject(ctx, sink, projectID)
		}
	}
}

func (s *Shipper) shipProject(ctx context.Context, sink *domain.EventSink, projectID string) {
	cursor, err := s.src.GetEventSinkCursor(ctx, sink.ID, projectID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); !ok {
			slog.Error("event shipper: get cursor failed",
				slog.String("sink_id", sink.ID),
				slog.String("project_id", projectID),
				slog.String("error", err.Error()),
			)
			return
		}
		cursor = &domain.EventSinkCursor{
			SinkID:    sink.ID,
			ProjectID: projectID,
		}
	}

	batch, err := s.src.ListEventsAfterCursor(ctx, projectID, cursor.LastCreatedAt, cursor.LastEventID, 100)
	if err != nil {
		slog.Error("event shipper: list after cursor failed",
			slog.String("sink_id", sink.ID),
			slog.String("project_id", projectID),
			slog.String("error", err.Error()),
		)
		return
	}
	for _, ev := range batch {
		if err := s.deliver(ctx, sink, ev); err != nil {
			slog.Error("event shipper: deliver failed",
				slog.String("sink_id", sink.ID),
				slog.String("project_id", projectID),
				slog.String("event_id", ev.ID),
				slog.String("error", err.Error()),
			)
			return
		}
		cursor.LastCreatedAt = ev.CreatedAt
		cursor.LastEventID = ev.ID
		if err := s.src.UpsertEventSinkCursor(ctx, cursor); err != nil {
			slog.Error("event shipper: upsert cursor failed",
				slog.String("sink_id", sink.ID),
				slog.String("project_id", projectID),
				slog.String("event_id", ev.ID),
				slog.String("error", err.Error()),
			)
			return
		}
	}
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
		return nil
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

func deploymentSinkID(sinkType domain.EventSinkType, url string) string {
	if sinkType == domain.EventSinkTypeStdout {
		return "sink_deployment_stdout"
	}
	sum := sha256.Sum256([]byte(string(sinkType) + "\n" + url))
	return "sink_deployment_" + hex.EncodeToString(sum[:8])
}
