package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
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

// UndeliveredEventSource loads events missing a delivery row for a sink.
type UndeliveredEventSource interface {
	ListUndeliveredEvents(ctx context.Context, sinkID string, limit int) ([]*domain.Event, error)
	RecordDelivery(ctx context.Context, projectID, eventID, sinkID string) error
	EnsureSink(ctx context.Context, sink *domain.EventSink) error
}

// Shipper delivers events to deployment-configured sinks (ADR 049).
type Shipper struct {
	cfg    ExportConfig
	src    UndeliveredEventSource
	client *http.Client
	sinks  []*domain.EventSink
	stop   chan struct{}
	done   chan struct{}
}

func NewShipper(src UndeliveredEventSource, cfg ExportConfig) *Shipper {
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

// Start ensures sinks and runs the shipper loop.
func (s *Shipper) Start(ctx context.Context) error {
	if !s.cfg.Enabled {
		close(s.done)
		return nil
	}
	for i, sc := range s.cfg.Sinks {
		if !sc.Enabled && sc.Type == "" {
			continue
		}
		enabled := sc.Enabled
		if sc.Type == "" {
			continue
		}
		sink := &domain.EventSink{
			Type:    sc.Type,
			Scope:   domain.EventSinkScopeDeployment,
			URL:     sc.URL,
			Enabled: enabled || sc.Type != "",
		}
		if sink.Type == domain.EventSinkTypeStdout {
			sink.ID = "sink_deployment_stdout"
		} else {
			sink.ID = "sink_deployment_webhook"
			if i > 0 {
				sink.ID = "sink_deployment_webhook_" + string(rune('a'+i))
			}
		}
		if err := s.src.EnsureSink(ctx, sink); err != nil {
			return err
		}
		if sink.Enabled {
			s.sinks = append(s.sinks, sink)
		}
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
	for _, sink := range s.sinks {
		events, err := s.src.ListUndeliveredEvents(ctx, sink.ID, 100)
		if err != nil {
			slog.Error("event shipper: list undelivered failed",
				slog.String("sink_id", sink.ID),
				slog.String("error", err.Error()),
			)
			continue
		}
		for _, ev := range events {
			if err := s.deliver(ctx, sink, ev); err != nil {
				slog.Error("event shipper: deliver failed",
					slog.String("sink_id", sink.ID),
					slog.String("event_id", ev.ID),
					slog.String("error", err.Error()),
				)
				continue
			}
			if err := s.src.RecordDelivery(ctx, ev.ProjectID, ev.ID, sink.ID); err != nil {
				slog.Error("event shipper: record delivery failed",
					slog.String("sink_id", sink.ID),
					slog.String("event_id", ev.ID),
					slog.String("error", err.Error()),
				)
			}
		}
	}
}

func (s *Shipper) deliver(ctx context.Context, sink *domain.EventSink, ev *domain.Event) error {
	body, err := json.Marshal(ev)
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

// Close stops the shipper.
func (s *Shipper) Close() {
	select {
	case <-s.stop:
	default:
		close(s.stop)
	}
	<-s.done
}
