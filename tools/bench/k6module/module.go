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
	})
	return &ModuleInstance{root: r, vu: vu}
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
	tm := st.Tags.GetCurrentValues()
	tm.SetTag("op", oe.Op)
	tm.SetTag("lane", m.root.target.Lane)
	tm.SetTag("status_class", oe.StatusClass())
	tm.SetTag("code", oe.Code)
	metrics.PushIfNotDone(m.vu.Context(), st.Samples, metrics.Sample{
		TimeSeries: metrics.TimeSeries{Metric: m.root.errors, Tags: tm.Tags},
		Time:       time.Now(),
		Metadata:   tm.Metadata,
		Value:      1,
	})
	return oe
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
