// Package spike is the throwaway prototype for issue #1095: how much of the
// HTTP path should the xk6 Go module own?
//
// It registers one JavaScript module, k6/x/nextgen-spike, that exposes the
// same three operations — POST /flow, POST /flow/{id}/submit, GET /users/{id}
// — through three request shapes:
//
//   - "owned":     the module issues the request itself through the generated
//     ogen client over k6's per-VU transport, reproduces k6's
//     phase breakdown with net/http/httptrace via k6's own
//     httpext.Tracer, and emits its own nextgen_req_* metrics.
//   - "delegated": the module still calls the generated ogen client, but the
//     client's Do() hands the prepared *http.Request to k6's
//     httpext.MakeRequest. k6 performs the call, so the built-in
//     http_req_* metrics, the per-VU cookie jar and the
//     response-callback classification are all k6's.
//   - "prepared":  the module only prepares requests and verifies responses;
//     k6/http performs the call from JavaScript.
//
// None of this is meant to merge. The decision it informs is recorded on the
// issue.
package spike

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/nextgen/api/generated"
	"go.k6.io/k6/v2/js/modules"
	"go.k6.io/k6/v2/lib"
	"go.k6.io/k6/v2/metrics"
)

func init() {
	modules.Register("k6/x/nextgen-spike", new(RootModule))
}

// Operation ids used as the `op` tag. Paths carrying resource ids are never
// used as tags; this is the bounded vocabulary.
const (
	opCreateFlow     = "create_flow"
	opSubmitIdent    = "submit_identifier"
	opSubmitPassword = "submit_password"
	opGetUser        = "get_user"
)

// config is read once per process from the environment k6 was started with.
type config struct {
	Base          string
	ProjectID     string
	ProjectSecret string
	UserID        string
	Email         string
	Password      string
	Origin        string
	// OwnedTransport selects what the "owned" shape dials through: "k6" for
	// the VU's own k6 transport, "shared" for one process-wide http.Transport.
	OwnedTransport string
}

// RootModule is constructed once per k6 process. Process-wide state — the
// configuration, the credential cache and the custom metric handles — lives
// here and is shared by every VU.
type RootModule struct {
	once    sync.Once
	cfg     config
	cfgErr  error
	creds   *credentialCache
	metrics *ownedMetrics
	// shared is the process-wide transport for the "owned/shared" variant.
	shared *http.Transport
}

var _ modules.Module = (*RootModule)(nil)

// NewModuleInstance implements modules.Module.
func (r *RootModule) NewModuleInstance(vu modules.VU) modules.Instance {
	r.once.Do(func() {
		env := vu.InitEnv()
		get := func(key string) string {
			v, _ := env.LookupEnv(key)
			return v
		}
		r.cfg = config{
			Base:           get("BASE"),
			ProjectID:      get("PROJECT_ID"),
			ProjectSecret:  get("PROJECT_SECRET"),
			UserID:         get("USER_ID"),
			Email:          get("EMAIL"),
			Password:       get("PASSWORD"),
			Origin:         get("ORIGIN"),
			OwnedTransport: get("NEXTGEN_OWNED_TRANSPORT"),
		}
		if r.cfg.Origin == "" {
			r.cfg.Origin = "http://localhost:3000"
		}
		if r.cfg.OwnedTransport == "" {
			r.cfg.OwnedTransport = "k6"
		}
		for _, kv := range [][2]string{
			{"BASE", r.cfg.Base}, {"PROJECT_ID", r.cfg.ProjectID}, {"PROJECT_SECRET", r.cfg.ProjectSecret},
			{"USER_ID", r.cfg.UserID}, {"EMAIL", r.cfg.Email}, {"PASSWORD", r.cfg.Password},
		} {
			if kv[1] == "" {
				r.cfgErr = errors.Join(r.cfgErr, fmt.Errorf("nextgen-spike: %s is not set", kv[0]))
			}
		}
		r.creds = newCredentialCache(r.cfg.ProjectSecret)
		r.metrics = newOwnedMetrics(env.Registry)
		//egress:allow benchmark load generator talking to the server under test
		r.shared = &http.Transport{
			MaxIdleConns:        256,
			MaxIdleConnsPerHost: 256,
			IdleConnTimeout:     90 * time.Second,
			DisableCompression:  true,
		}
	})
	return &ModuleInstance{root: r, vu: vu}
}

// ModuleInstance is constructed once per VU. Anything that needs the VU's
// lib.State — the transport, the cookie jar, the sample channel — hangs off
// it, lazily, because State() is nil in the init context.
type ModuleInstance struct {
	root *RootModule
	vu   modules.VU

	owned     *api.Client
	delegated *api.Client
}

var _ modules.Instance = (*ModuleInstance)(nil)

// Exports implements modules.Instance.
func (m *ModuleInstance) Exports() modules.Exports {
	return modules.Exports{Default: m}
}

func (m *ModuleInstance) state() (*lib.State, error) {
	if m.root.cfgErr != nil {
		return nil, m.root.cfgErr
	}
	st := m.vu.State()
	if st == nil {
		return nil, errors.New("nextgen-spike: not available in the init context")
	}
	return st, nil
}

// client returns the per-VU ogen client for a shape, building it on first use.
func (m *ModuleInstance) client(shape string) (*api.Client, error) {
	st, err := m.state()
	if err != nil {
		return nil, err
	}
	var slot **api.Client
	var doer doer
	switch shape {
	case "owned":
		slot = &m.owned
		doer = &ownedDoer{m: m, st: st}
	case "delegated":
		slot = &m.delegated
		doer = &delegatedDoer{m: m, st: st}
	default:
		return nil, fmt.Errorf("nextgen-spike: unknown shape %q (owned, delegated)", shape)
	}
	if *slot == nil {
		c, err := api.NewClient(m.root.cfg.Base, m.root.creds, api.WithClient(doer))
		if err != nil {
			return nil, err
		}
		*slot = c
	}
	return *slot, nil
}

// doer is what ogen's WithClient accepts: the one seam the generated client
// offers for taking over the transport call.
type doer interface {
	Do(*http.Request) (*http.Response, error)
}

// opKey carries the operation id from the typed call into Do(), which only
// sees the *http.Request. The generated client propagates the context.
type opKey struct{}

func withOp(ctx context.Context, op string) context.Context {
	return context.WithValue(ctx, opKey{}, op)
}

func opFrom(r *http.Request) string {
	if op, ok := r.Context().Value(opKey{}).(string); ok {
		return op
	}
	return "unknown"
}

// credentialCache is the process-wide credential holder the harness will
// grow into (#1107). For the spike it holds the one credential that matters:
// the project secret the operator plane needs for GET /users/{id}. It is the
// ogen SecuritySource for the Go shapes and is read by prepareGetUser for the
// JavaScript shape, so the "is it reachable from JS" question has an answer.
type credentialCache struct {
	mu     sync.RWMutex
	bearer string
}

func newCredentialCache(bearer string) *credentialCache {
	return &credentialCache{bearer: bearer}
}

func (c *credentialCache) Bearer() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.bearer
}

// OAuth2 implements api.SecuritySource.
func (c *credentialCache) OAuth2(context.Context, api.OperationName) (api.OAuth2, error) {
	return api.OAuth2{Token: c.Bearer()}, nil
}

// NextgenSession implements api.SecuritySource. The spike never holds a
// session cookie; skipping lets the client fall through to the bearer.
func (c *credentialCache) NextgenSession(context.Context, api.OperationName) (api.NextgenSession, error) {
	return api.NextgenSession{}, ogenerrors.ErrSkipClientSecurity
}

// ownedMetrics are the module's own instruments for the "owned" shape. They
// mirror k6's http_req_* vocabulary one for one so the two can be compared,
// under their own names so they are never confused with k6's (#1104).
type ownedMetrics struct {
	reqs       *metrics.Metric
	duration   *metrics.Metric
	blocked    *metrics.Metric
	connecting *metrics.Metric
	sending    *metrics.Metric
	waiting    *metrics.Metric
	receiving  *metrics.Metric
	failed     *metrics.Metric
	connReused *metrics.Metric
	// jarCookie records, for the delegated shape, whether k6's per-VU cookie
	// jar held the sealed _zflow cookie after POST /flow.
	jarCookie *metrics.Metric
}

func newOwnedMetrics(reg *metrics.Registry) *ownedMetrics {
	return &ownedMetrics{
		reqs:       reg.MustNewMetric("nextgen_reqs", metrics.Counter),
		duration:   reg.MustNewMetric("nextgen_req_duration", metrics.Trend, metrics.Time),
		blocked:    reg.MustNewMetric("nextgen_req_blocked", metrics.Trend, metrics.Time),
		connecting: reg.MustNewMetric("nextgen_req_connecting", metrics.Trend, metrics.Time),
		sending:    reg.MustNewMetric("nextgen_req_sending", metrics.Trend, metrics.Time),
		waiting:    reg.MustNewMetric("nextgen_req_waiting", metrics.Trend, metrics.Time),
		receiving:  reg.MustNewMetric("nextgen_req_receiving", metrics.Trend, metrics.Time),
		failed:     reg.MustNewMetric("nextgen_req_failed", metrics.Rate),
		connReused: reg.MustNewMetric("nextgen_conn_reused", metrics.Rate),
		jarCookie:  reg.MustNewMetric("nextgen_jar_has_zflow", metrics.Rate),
	}
}
