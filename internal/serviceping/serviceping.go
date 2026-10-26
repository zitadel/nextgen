// Package serviceping reports, on an interval, which version and storage
// dialect a deployment runs, as one anonymous event to Vercel Web Analytics
// and to Mixpanel.
//
// Proof of concept: the event is named with a poc_ prefix so proof traffic
// never mixes with a released ping's events, and the ping is off by default.
package serviceping

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"runtime"
	"sync"
	"time"
)

// EventPrefix keeps proof traffic apart from a released ping's events; the
// product analytics catalog lists the event without it.
const EventPrefix = "poc_"

// EventName is the event every ping sends.
const EventName = EventPrefix + "service_ping"

// DefaultVercelEndpoint is the cloud project's Web Analytics intake, the URL
// `@vercel/analytics/server` posts custom events to.
const DefaultVercelEndpoint = "https://preview.zitadel.com/_vercel/insights/event"

// DefaultMixpanelEndpoint is Mixpanel's track API behind the cloud's proxy,
// the `/telemetry/mixpanel/*` rewrite in the repo-root vercel.json.
const DefaultMixpanelEndpoint = "https://preview.zitadel.com/telemetry/mixpanel/track"

// DefaultMixpanelToken is the CLI's production project's ingestion token. It
// can only add events, so it is published on purpose, as the CLI's copy is
// (apps/cli/src/lib/telemetry/config.ts).
const DefaultMixpanelToken = "f56fd7315ccd614fba8eecb2a8966152"

// MaxProperties is the custom-event property limit of Web Analytics Plus.
const MaxProperties = 8

// Config controls the service ping. A destination without an endpoint, or
// Mixpanel without a token, is left out.
type Config struct {
	Enabled          bool          `mapstructure:"enabled"`
	VercelEndpoint   string        `mapstructure:"vercel_endpoint"`
	MixpanelEndpoint string        `mapstructure:"mixpanel_endpoint"`
	MixpanelToken    string        `mapstructure:"mixpanel_token"`
	Interval         time.Duration `mapstructure:"interval"`
}

// Facts are what a ping reports: versions and enums only, never a host, an
// id or anything else that identifies a deployment.
type Facts struct {
	Version string
	// Commit is the git commit the server was built from.
	Commit  string
	Dialect string
	// OnVercel is true when the server runs as a Vercel Function, which is
	// what the hosted cloud does.
	OnVercel bool
	// PublicBase is the origin the server is reachable at. Only whether its
	// host is loopback is reported, never the origin.
	PublicBase string
}

// Properties returns what both destinations get: the header every Zitadel
// component sends, as docs/product-analytics-events.yaml defines it, then the
// server's dialect and platform. It holds at most MaxProperties keys.
func (f Facts) Properties() map[string]any {
	return map[string]any{
		"surface":        "server",
		"server_version": f.version(),
		"server_kind":    f.kind(),
		"dialect":        f.Dialect,
		"os":             nodeOS(runtime.GOOS),
		"arch":           nodeArch(runtime.GOARCH),
	}
}

// version is the release version, except in the cloud, which deploys every
// commit under the same one and so reports the commit.
func (f Facts) version() string {
	if f.OnVercel {
		return f.Commit
	}
	return f.Version
}

// kind sorts the deployment as the CLI sorts the servers it talks to: a
// server on a loopback host, such as one `zitadel start` runs, is local.
func (f Facts) kind() string {
	if f.OnVercel {
		return "cloud"
	}
	if base, err := url.Parse(f.PublicBase); err == nil {
		switch base.Hostname() {
		case "localhost", "127.0.0.1", "::1":
			return "local"
		}
	}
	return "self_hosted"
}

// nodeOS and nodeArch name the platform as Node.js does, like the CLI's
// events and the server's npm packages (server-win32-x64).
func nodeOS(goos string) string {
	if goos == "windows" {
		return "win32"
	}
	return goos
}

func nodeArch(goarch string) string {
	if goarch == "amd64" {
		return "x64"
	}
	return goarch
}

// vercelEvent is the body `@vercel/analytics/server` sends for a custom event.
type vercelEvent struct {
	Origin     string         `json:"o"`
	Timestamp  int64          `json:"ts"`
	SDKName    string         `json:"sdkn"`
	SDKVersion string         `json:"sdkv"`
	Referrer   string         `json:"r"`
	Name       string         `json:"en"`
	Data       map[string]any `json:"ed"`
}

// mixpanelEvent is one event as Mixpanel's track API takes it.
type mixpanelEvent struct {
	Event      string         `json:"event"`
	Properties map[string]any `json:"properties"`
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

// destination is one place a ping goes.
type destination struct {
	name     string
	endpoint string
	send     func(context.Context, time.Time) error
}

func (p *Pinger) destinations() []destination {
	var all []destination
	if p.cfg.VercelEndpoint != "" {
		all = append(all, destination{name: "vercel", endpoint: p.cfg.VercelEndpoint, send: p.sendVercel})
	}
	if p.cfg.MixpanelEndpoint != "" && p.cfg.MixpanelToken != "" {
		all = append(all, destination{name: "mixpanel", endpoint: p.cfg.MixpanelEndpoint, send: p.sendMixpanel})
	}
	return all
}

// sendOnce sends one ping to each destination. A failure is logged and never
// reaches the server.
func (p *Pinger) sendOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	now := time.Now()
	for _, d := range p.destinations() {
		if err := d.send(ctx, now); err != nil {
			slog.Warn("service ping failed", slog.String("destination", d.name), slog.String("error", err.Error()))
			continue
		}
		slog.Info("service ping sent", slog.String("destination", d.name), slog.String("endpoint", d.endpoint))
	}
}

func (p *Pinger) sendVercel(ctx context.Context, now time.Time) error {
	endpoint, err := url.Parse(p.cfg.VercelEndpoint)
	if err != nil {
		return fmt.Errorf("parse endpoint: %w", err)
	}
	body, err := json.Marshal(vercelEvent{
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
	req, err := p.newRequest(ctx, p.cfg.VercelEndpoint, body)
	if err != nil {
		return err
	}
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

// mixpanelProperties adds what Mixpanel needs to the ping's properties: the
// token, the time, an $insert_id so a resent ping is counted once, and ip: 0
// so Mixpanel does not locate the server by its address. It sends no
// distinct_id: the server has no install id yet.
func (p *Pinger) mixpanelProperties(now time.Time, insertID string) map[string]any {
	properties := p.facts.Properties()
	properties["token"] = p.cfg.MixpanelToken
	properties["time"] = now.UnixMilli()
	properties["$insert_id"] = insertID
	properties["ip"] = 0
	return properties
}

func (p *Pinger) sendMixpanel(ctx context.Context, now time.Time) error {
	endpoint, err := url.Parse(p.cfg.MixpanelEndpoint)
	if err != nil {
		return fmt.Errorf("parse endpoint: %w", err)
	}
	query := endpoint.Query()
	query.Set("ip", "0")
	query.Set("verbose", "1")
	endpoint.RawQuery = query.Encode()
	insertID, err := newInsertID()
	if err != nil {
		return err
	}
	body, err := json.Marshal([]mixpanelEvent{{Event: EventName, Properties: p.mixpanelProperties(now, insertID)}})
	if err != nil {
		return err
	}
	req, err := p.newRequest(ctx, endpoint.String(), body)
	if err != nil {
		return err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("mixpanel answered %s", resp.Status)
	}
	// verbose=1 makes Mixpanel say whether it took the event.
	var answer struct {
		Status int    `json:"status"`
		Error  string `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&answer); err != nil {
		return fmt.Errorf("read mixpanel's answer: %w", err)
	}
	if answer.Status != 1 {
		return fmt.Errorf("mixpanel refused the event: %s", answer.Error)
	}
	return nil
}

func (p *Pinger) newRequest(ctx context.Context, endpoint string, body []byte) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", fmt.Sprintf("zitadel-server/%s (%s; %s)", p.facts.Version, runtime.GOOS, runtime.GOARCH))
	return req, nil
}

// newInsertID returns a random dedupe key for one Mixpanel event, within the
// 36 letters, digits and dashes Mixpanel allows. It is no resource id.
func newInsertID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("make an insert id: %w", err)
	}
	return hex.EncodeToString(raw), nil
}

// Close stops the pinger and waits for an in-flight ping, up to a timeout.
func (p *Pinger) Close() {
	p.stopOnce.Do(func() { close(p.stop) })
	select {
	case <-p.done:
	case <-time.After(closeTimeout):
	}
}
