// Package k6module registers the k6/x/nextgen JavaScript module: the
// benchmark scenarios' entry into the server, driven through the generated
// client with k6 performing every request (ADR 066).
package k6module

import (
	"context"
	"errors"
	"sync"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
	"go.k6.io/k6/v2/js/modules"
	"go.k6.io/k6/v2/metrics"

	"github.com/zitadel/nextgen/tools/bench/harness"
)

func init() {
	modules.Register("k6/x/nextgen", new(RootModule))
}

type contextT = context.Context

// RootModule is constructed once per k6 process. Process-wide state — the
// target read from the environment, the credential cache and the module's
// own metric — lives here and is shared by every VU.
type RootModule struct {
	once   sync.Once
	target harness.Target
	err    error
	creds  *harness.Credentials
	errors *metrics.Metric

	// sessions is the process-wide session cache. Its two metrics are
	// registered here and pushed from whichever VU is on the request path:
	// the cache's own logins use plain net/http, so they emit no http_req_*
	// samples and stay out of every operation trend.
	sessions       *harness.SessionCache
	sessionMiss    *metrics.Metric
	sessionRefresh *metrics.Metric
	sessionCount   *metrics.Metric
}

var _ modules.Module = (*RootModule)(nil)

// NewModuleInstance implements modules.Module.
func (r *RootModule) NewModuleInstance(vu modules.VU) modules.Instance {
	r.once.Do(func() {
		env := vu.InitEnv()
		r.target, r.err = harness.TargetFromEnv(env.LookupEnv)
		if r.err != nil {
			r.err = errors.Join(errors.New("k6/x/nextgen: run through `k6 x nextgen sweep`, or pass the target as -e"), r.err)
		}
		r.creds = harness.NewCredentials(r.target.ProjectSecret)
		// Registered once, on the root, and pushed from every VU through its
		// sample channel, so thresholds and the summary see it like a
		// built-in metric.
		r.errors = env.Registry.MustNewMetric(harness.MetricErrors, metrics.Counter)
		r.sessionMiss = env.Registry.MustNewMetric(harness.MetricSessionMiss, metrics.Counter)
		r.sessionRefresh = env.Registry.MustNewMetric(harness.MetricSessionRefresh, metrics.Trend, metrics.Time)
		r.sessionCount = env.Registry.MustNewMetric(harness.MetricSessionRefreshes, metrics.Counter)
		if r.err == nil {
			r.err = r.newSessions(env.LookupEnv)
		}
	})
	return &ModuleInstance{root: r, vu: vu}
}

func (r *RootModule) newSessions(lookup func(string) (string, bool)) error {
	settings, err := harness.SessionSettingsFromEnv(lookup)
	if err != nil {
		return err
	}
	login, err := harness.NewSessionLogin(r.target, settings.TTL)
	if err != nil {
		return err
	}
	r.sessions = harness.NewSessionCache(settings.CacheConfig(), login)
	return nil
}

// ModuleInstance is constructed once per VU. The generated client hangs off
// it lazily because its Do needs the VU's lib.State, which is nil in the init
// context.
type ModuleInstance struct {
	root   *RootModule
	vu     modules.VU
	client *api.Client
}

var _ modules.Instance = (*ModuleInstance)(nil)

// Exports implements modules.Instance.
func (m *ModuleInstance) Exports() modules.Exports {
	return modules.Exports{Default: m}
}

func (m *ModuleInstance) api() (*api.Client, error) {
	if m.root.err != nil {
		return nil, m.root.err
	}
	if m.client != nil {
		return m.client, nil
	}
	st := m.vu.State()
	if st == nil {
		return nil, errors.New("k6/x/nextgen: not available in the init context")
	}
	c, err := api.NewClient(m.root.target.Base, m.root.creds, api.WithClient(&doer{
		st:     st,
		ctx:    m.vu.Context,
		origin: m.root.target.Origin,
		lane:   m.root.target.Lane,
	}))
	if err != nil {
		return nil, err
	}
	m.client = c
	return c, nil
}

// fail counts a failed operation on nextgen_errors — tagged with the
// operation, the lane, the status class and the error code — and returns the
// error for k6 to fail the iteration with. The request's own sample was
// already emitted by k6; this is the classification it cannot know.
func (m *ModuleInstance) fail(op string, err error) error {
	st := m.vu.State()
	if st == nil {
		return err
	}
	oe := harness.Classify(op, err)
	m.push(m.root.errors, time.Now(), 1, map[string]string{
		"op": oe.Op, "status_class": oe.StatusClass(), "code": oe.Code,
	})
	return oe
}

// push emits one sample of a module metric on this VU's channel, tagged with
// the lane and the given tags.
func (m *ModuleInstance) push(metric *metrics.Metric, at time.Time, value float64, tags map[string]string) {
	st := m.vu.State()
	if st == nil {
		return
	}
	tm := st.Tags.GetCurrentValues()
	tm.SetTag("lane", m.root.target.Lane)
	for k, v := range tags {
		tm.SetTag(k, v)
	}
	metrics.PushIfNotDone(m.vu.Context(), st.Samples, metrics.Sample{
		TimeSeries: metrics.TimeSeries{Metric: metric, Tags: tm.Tags},
		Time:       at,
		Metadata:   tm.Metadata,
		Value:      value,
	})
}

// WarmSessions establishes the sessions a run of vus VUs needs and starts the
// cache's background refresh. Call it from the script's setup(), so the
// logins happen before anything is measured and a first measured request is
// never a miss.
func (m *ModuleInstance) WarmSessions(vus int) error {
	if m.root.err != nil {
		return m.root.err
	}
	return m.root.sessions.Warm(m.vu.Context(), m.root.sessions.SlotsFor(vus))
}

// flushSessionRecords moves what the cache has recorded of its own logins onto
// the refresh metric, with the time each login ran.
func (m *ModuleInstance) flushSessionRecords() {
	for _, rec := range m.root.sessions.DrainRecords() {
		result, path := "ok", "background"
		if !rec.OK {
			result = "error"
		}
		if rec.MeasuredPath {
			path = "miss"
		}
		tags := map[string]string{"result": result, "path": path}
		m.push(m.root.sessionRefresh, rec.At, float64(rec.Duration)/float64(time.Millisecond), tags)
		m.push(m.root.sessionCount, rec.At, 1, tags)
	}
}

// GetMySession performs GET /sessions/me with a session from the cache.
// vuID selects the session under the run's affinity: every VU shares one, or
// each holds its own. A cache miss is counted before the request is made, so
// the login a miss costs is attributed to the miss and not to the operation.
func (m *ModuleInstance) GetMySession(vuID int) (string, error) {
	c, err := m.api()
	if err != nil {
		return "", err
	}
	cache := m.root.sessions
	sess, miss, err := cache.Get(m.vu.Context(), cache.Slot(vuID))
	if miss {
		m.push(m.root.sessionMiss, time.Now(), 1, nil)
	}
	m.flushSessionRecords()
	if err != nil {
		return "", m.fail(harness.OpGetMySession, err)
	}
	id, err := harness.GetMySession(harness.WithSession(m.vu.Context(), sess.Token), c)
	if err != nil {
		return "", m.fail(harness.OpGetMySession, err)
	}
	return id, nil
}

// Operations returns the operation ids, for the entry script to declare one
// sub-metric per operation from the same vocabulary the tags use.
func (m *ModuleInstance) Operations() []string {
	return harness.Operations
}

// Metrics returns the metrics the summary reports per operation: k6's
// built-in request metrics and the module's nextgen_errors.
func (m *ModuleInstance) Metrics() []string {
	return harness.SummaryMetrics
}

// SessionMetrics returns the session cache's metrics, which the summary
// reports on their own rather than per operation.
func (m *ModuleInstance) SessionMetrics() []string {
	return harness.SessionMetrics
}

// Login runs the whole login journey — POST /flow, submit identifier, submit
// password — and returns the handoff token. One JavaScript call, three
// requests, each tagged with its own operation id.
func (m *ModuleInstance) Login() (harness.LoginResult, error) {
	c, err := m.api()
	if err != nil {
		return harness.LoginResult{}, err
	}
	res, err := harness.Login(m.vu.Context(), c, m.root.target)
	if err != nil {
		return harness.LoginResult{}, m.fail(harness.OpCreateFlow, err)
	}
	return res, nil
}

// GetUser performs GET /users/{id} on the fixture user with the cached
// operator bearer and returns the user's id.
func (m *ModuleInstance) GetUser() (map[string]string, error) {
	c, err := m.api()
	if err != nil {
		return nil, err
	}
	u, err := harness.GetUser(m.vu.Context(), c, m.root.target)
	if err != nil {
		return nil, m.fail(harness.OpGetUser, err)
	}
	return map[string]string{"id": string(u.ID)}, nil
}
