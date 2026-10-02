package spike

import (
	"fmt"

	"github.com/go-faster/jx"
	api "github.com/zitadel/nextgen/api/generated"
)

// The "prepared" shape: k6/http performs the request from JavaScript; the
// module builds request bodies with the generated encoders, hands out the
// request parameters (headers, bounded tags, the cached bearer) and decodes
// responses with the generated decoders. The typed client itself is unused —
// ogen exposes no "build but do not send" seam — so the module re-states each
// operation's method, path and content type by hand.

type prepared struct {
	URL    string         `js:"url"`
	Body   string         `js:"body"`
	Params map[string]any `js:"params"`
}

func (m *ModuleInstance) params(op string, headers map[string]string) map[string]any {
	h := map[string]string{"Content-Type": "application/json", "Origin": m.root.cfg.Origin}
	for k, v := range headers {
		h[k] = v
	}
	return map[string]any{
		"headers": h,
		// name bounds the url/name system tags; op and shape are the module's own.
		"tags": map[string]string{"name": op, "op": op, "shape": "prepared"},
	}
}

// PrepareCreateFlow returns the POST /flow request for k6/http.
func (m *ModuleInstance) PrepareCreateFlow() (*prepared, error) {
	if m.root.cfgErr != nil {
		return nil, m.root.cfgErr
	}
	var e jx.Encoder
	(&api.CreateFlowRequest{
		ProjectID: api.ProjectID(m.root.cfg.ProjectID),
		Purpose:   api.CreateFlowRequestPurposeLogin,
	}).Encode(&e)
	return &prepared{URL: m.root.cfg.Base + "/flow", Body: string(e.Bytes()), Params: m.params(opCreateFlow, nil)}, nil
}

// PrepareSubmit returns the POST /flow/{id}/submit request. The _zflow cookie
// is not part of it: k6's per-VU jar stored it from the previous response and
// sends it automatically, exactly as a browser would.
func (m *ModuleInstance) PrepareSubmit(op, id string, fields map[string]string) (*prepared, error) {
	if m.root.cfgErr != nil {
		return nil, m.root.cfgErr
	}
	req, err := submitRequest(fields)
	if err != nil {
		return nil, err
	}
	var e jx.Encoder
	req.Encode(&e)
	return &prepared{URL: m.root.cfg.Base + "/flow/" + id + "/submit", Body: string(e.Bytes()), Params: m.params(op, nil)}, nil
}

// PrepareGetUser returns the GET /users/{id} request with the bearer from the
// process-wide credential cache — the cache crossing into JavaScript.
func (m *ModuleInstance) PrepareGetUser() (*prepared, error) {
	if m.root.cfgErr != nil {
		return nil, m.root.cfgErr
	}
	return &prepared{
		URL:    m.root.cfg.Base + "/users/" + m.root.cfg.UserID,
		Params: m.params(opGetUser, map[string]string{"Authorization": "Bearer " + m.root.creds.Bearer()}),
	}, nil
}

// VerifyFlow decodes a flow response body with the generated decoder and
// returns what the next step needs. A non-2xx status or a step-level error
// is a thrown error, so the iteration fails loudly.
func (m *ModuleInstance) VerifyFlow(op string, status int, body string) (map[string]any, error) {
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("%s: status %d: %s", op, status, truncate(body))
	}
	var fr api.FlowResponse
	if err := fr.Decode(jx.DecodeStr(body)); err != nil {
		return nil, fmt.Errorf("%s: decode: %w", op, err)
	}
	if e, ok := fr.Step.Error.Get(); ok {
		return nil, fmt.Errorf("%s: step %q answered error %q", op, fr.Step.Name, e)
	}
	out := map[string]any{"id": fr.ID, "session_id": fr.SessionID, "step": fr.Step.Name}
	if h, ok := fr.HandoffToken.Get(); ok {
		out["handoff_token"] = h
	}
	return out, nil
}

// VerifyUser decodes a user response body with the generated decoder.
func (m *ModuleInstance) VerifyUser(status int, body string) (map[string]any, error) {
	if status != 200 {
		return nil, fmt.Errorf("%s: status %d: %s", opGetUser, status, truncate(body))
	}
	var u api.User
	if err := u.Decode(jx.DecodeStr(body)); err != nil {
		return nil, fmt.Errorf("%s: decode: %w", opGetUser, err)
	}
	return map[string]any{"id": string(u.ID)}, nil
}

func truncate(s string) string {
	if len(s) > 200 {
		return s[:200] + "…"
	}
	return s
}
