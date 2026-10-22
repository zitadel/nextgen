// Package serviceping reports, on an interval, which version and storage
// dialect a deployment runs, as one anonymous event to Vercel Web Analytics.
//
// Proof of concept: the event is named with a poc_ prefix so proof traffic
// never mixes with a released ping's events, and the ping is off by default.
package serviceping

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"runtime"
	"sync"
	"time"
)

// EventName is the event every ping sends.
const EventName = "poc_service_ping"

// DefaultEndpoint is the cloud project's Web Analytics intake, the URL
// `@vercel/analytics/server` posts custom events to.
const DefaultEndpoint = "https://preview.zitadel.com/_vercel/insights/event"

// MaxProperties is the custom-event property limit of Web Analytics Plus.
const MaxProperties = 8

// Config controls the service ping.
type Config struct {
	Enabled  bool          `mapstructure:"enabled"`
	Endpoint string        `mapstructure:"endpoint"`
	Interval time.Duration `mapstructure:"interval"`
}

// Facts are what a ping reports: versions and enums only, never a host, an
// id or anything else that identifies a deployment.
type Facts struct {
	Version string
	Dialect string
	// OnVercel is true when the server runs as a Vercel Function, which is
	// what the hosted cloud does.
	OnVercel bool
}

// Properties returns the event data; it holds at most MaxProperties keys.
func (f Facts) Properties() map[string]any {
	platform := "self_hosted"
	if f.OnVercel {
		platform = "vercel"
	}
	return map[string]any{
		"version":  f.Version,
		"dialect":  f.Dialect,
		"platform": platform,
		"os":       runtime.GOOS,
		"arch":     runtime.GOARCH,
	}
}

// event is the body `@vercel/analytics/server` sends for a custom event.
type event struct {
	Origin     string         `json:"o"`
	Timestamp  int64          `json:"ts"`
	SDKName    string         `json:"sdkn"`
	SDKVersion string         `json:"sdkv"`
	Referrer   string         `json:"r"`
	Name       string         `json:"en"`
	Data       map[string]any `json:"ed"`
}

const closeTimeout = 5 * time.Second

// Pinger sends a ping on start and then once per interval.
type Pinger struct {
	cfg      Config
	facts    Facts
	client   *http.Client
	stop     chan struct{}
	stopOnce sync.Once
	done     chan struct{}
}

// New returns a pinger; Start does nothing when cfg.Enabled is false.
func New(cfg Config, facts Facts) *Pinger {
	if cfg.Endpoint == "" {
		cfg.Endpoint = DefaultEndpoint
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 24 * time.Hour
	}
	return &Pinger{
		cfg:   cfg,
		facts: facts,
		// Operator-configured URL, not user-injectable: stdlib client by design (ADR 061).
		//egress:allow operator-configured service ping endpoint, not user-injectable (ADR 061)
		client: &http.Client{Timeout: 10 * time.Second},
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
	}
}

// Start begins pinging in the background.
func (p *Pinger) Start() {
	if !p.cfg.Enabled {
		close(p.done)
		return
	}
	go p.loop()
}

func (p *Pinger) loop() {
	defer close(p.done)
	ticker := time.NewTicker(p.cfg.Interval)
	defer ticker.Stop()
	p.sendOnce()
	for {
		select {
		case <-p.stop:
			return
		case <-ticker.C:
			p.sendOnce()
		}
	}
}

// sendOnce sends one ping. A failure is logged and never reaches the server.
func (p *Pinger) sendOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := p.send(ctx, time.Now()); err != nil {
		slog.Warn("service ping failed", slog.String("error", err.Error()))
		return
	}
	slog.Info("service ping sent", slog.String("endpoint", p.cfg.Endpoint))
}

func (p *Pinger) send(ctx context.Context, now time.Time) error {
	endpoint, err := url.Parse(p.cfg.Endpoint)
	if err != nil {
		return fmt.Errorf("parse endpoint: %w", err)
	}
	body, err := json.Marshal(event{
		Origin:     endpoint.Scheme + "://" + endpoint.Host,
		Timestamp:  now.UnixMilli(),
		SDKName:    "zitadel-server",
		SDKVersion: p.facts.Version,
		Name:       EventName,
		Data:       p.facts.Properties(),
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.cfg.Endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", fmt.Sprintf("zitadel-server/%s (%s; %s)", p.facts.Version, runtime.GOOS, runtime.GOARCH))
	// What `@vercel/analytics/server` sends to mark an event as server-side.
	req.Header.Set("X-Va-Server", "1")
	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("intake answered %s", resp.Status)
	}
	return nil
}

// Close stops the pinger and waits for an in-flight ping, up to a timeout.
func (p *Pinger) Close() {
	p.stopOnce.Do(func() { close(p.stop) })
	select {
	case <-p.done:
	case <-time.After(closeTimeout):
	}
}
