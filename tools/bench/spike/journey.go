package spike

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/go-faster/jx"
	api "github.com/zitadel/nextgen/api/generated"
	"go.k6.io/k6/v2/metrics"
)

// Login drives POST /flow → submit identifier → submit password through the
// typed client for the given shape ("owned" or "delegated") and returns the
// handoff token. This is the entire login journey; the JavaScript side is one
// call.
func (m *ModuleInstance) Login(shape string) (map[string]any, error) {
	c, err := m.client(shape)
	if err != nil {
		return nil, err
	}
	ctx := m.vu.Context()
	cfg := m.root.cfg

	created, err := c.CreateFlow(withOp(ctx, opCreateFlow), &api.CreateFlowRequest{
		ProjectID: api.ProjectID(cfg.ProjectID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", opCreateFlow, err)
	}
	flow, ok := created.(*api.FlowResponseHeaders)
	if !ok {
		return nil, fmt.Errorf("%s: unexpected response %T", opCreateFlow, created)
	}
	zflow, err := cookieValue(flow.SetCookie, "_zflow")
	if err != nil {
		return nil, fmt.Errorf("%s: %w", opCreateFlow, err)
	}
	if shape == "delegated" {
		m.checkJar(zflow)
	}

	step, err := m.submit(ctx, c, opSubmitIdent, flow.Response.ID, zflow, map[string]string{"email": cfg.Email})
	if err != nil {
		return nil, err
	}
	zflow, err = cookieValue(step.SetCookie, "_zflow")
	if err != nil {
		return nil, fmt.Errorf("%s: %w", opSubmitIdent, err)
	}

	step, err = m.submit(ctx, c, opSubmitPassword, step.Response.ID, zflow, map[string]string{"x-auth-methods#password": cfg.Password})
	if err != nil {
		return nil, err
	}
	handoff, ok := step.Response.HandoffToken.Get()
	if !ok {
		return nil, fmt.Errorf("%s: no handoff token; step %q error %q", opSubmitPassword, step.Response.Step.Name, step.Response.Step.Error.Or(""))
	}
	return map[string]any{"handoff_token": handoff, "session_id": step.Response.SessionID}, nil
}

func (m *ModuleInstance) submit(ctx context.Context, c *api.Client, op, id, zflow string, fields map[string]string) (*api.SubmitFlowStepOK, error) {
	req, err := submitRequest(fields)
	if err != nil {
		return nil, err
	}
	res, err := c.SubmitFlowStep(withOp(ctx, op), req, api.SubmitFlowStepParams{ID: id, Zflow: zflow})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	switch r := res.(type) {
	case *api.SubmitFlowStepOK:
		if e, ok := r.Response.Step.Error.Get(); ok {
			return nil, fmt.Errorf("%s: step %q answered error %q", op, r.Response.Step.Name, e)
		}
		return r, nil
	case *api.SubmitFlowStepBadRequest:
		return nil, fmt.Errorf("%s: 400 step %q error %q", op, r.Response.Step.Name, r.Response.Step.Error.Or(""))
	case *api.ErrorDetails:
		return nil, fmt.Errorf("%s: %s: %s", op, r.Code, r.Message)
	default:
		return nil, fmt.Errorf("%s: unexpected response %T", op, res)
	}
}

func submitRequest(fields map[string]string) (*api.FlowSubmitRequest, error) {
	raw := make(api.FlowSubmitRequestFields, len(fields))
	for k, v := range fields {
		b, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		raw[k] = jx.Raw(b)
	}
	return &api.FlowSubmitRequest{Action: "submit", Fields: api.NewOptFlowSubmitRequestFields(raw)}, nil
}

// GetUser performs GET /users/{id} with the cached operator bearer.
func (m *ModuleInstance) GetUser(shape string) (map[string]any, error) {
	c, err := m.client(shape)
	if err != nil {
		return nil, err
	}
	res, err := c.GetUserByID(withOp(m.vu.Context(), opGetUser), api.GetUserByIDParams{UserID: api.UserID(m.root.cfg.UserID)})
	if err != nil {
		return nil, fmt.Errorf("%s: %w", opGetUser, err)
	}
	switch r := res.(type) {
	case *api.User:
		return map[string]any{"id": string(r.ID)}, nil
	case *api.GetUserByIDUnauthorized:
		return nil, fmt.Errorf("%s: 401 %s", opGetUser, r.Message)
	case *api.GetUserByIDNotFound:
		return nil, fmt.Errorf("%s: 404 %s", opGetUser, r.Message)
	default:
		return nil, fmt.Errorf("%s: unexpected response %T", opGetUser, res)
	}
}

// cookieValue extracts one cookie from a Set-Cookie header the typed response
// carries as a plain string.
func cookieValue(setCookie api.OptString, name string) (string, error) {
	raw, ok := setCookie.Get()
	if !ok {
		return "", fmt.Errorf("response carried no Set-Cookie")
	}
	c, err := http.ParseSetCookie(raw)
	if err != nil {
		return "", err
	}
	if c.Name != name {
		return "", fmt.Errorf("Set-Cookie was %q, want %q", c.Name, name)
	}
	return c.Value, nil
}

// checkJar records whether k6's per-VU cookie jar received the sealed flow
// cookie from the delegated call — the "cookie handling" criterion for that
// shape. The owned shape never touches the jar: the typed client makes the
// cookie an explicit parameter and the module carries the value itself.
func (m *ModuleInstance) checkJar(zflow string) {
	st := m.vu.State()
	u, err := url.Parse(m.root.cfg.Base + "/flow")
	if err != nil || st.CookieJar == nil {
		return
	}
	var present float64
	for _, c := range st.CookieJar.Cookies(u) {
		if c.Name == "_zflow" && c.Value == zflow {
			present = 1
			break
		}
	}
	tm := st.Tags.GetCurrentValues()
	tm.SetTag("shape", "delegated")
	metrics.PushIfNotDone(m.vu.Context(), st.Samples, metrics.Sample{
		TimeSeries: metrics.TimeSeries{Metric: m.root.metrics.jarCookie, Tags: tm.Tags},
		Time:       time.Now(),
		Metadata:   tm.Metadata,
		Value:      present,
	})
}
