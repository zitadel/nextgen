package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/go-faster/jx"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	flowCookieName          = "_zflow"
	flowCookieMaxAgeSeconds = 600
)

var (
	errFlowCookieMissing = errors.New("flow cookie missing")
	errFlowCookieInvalid = errors.New("flow cookie invalid")
	errFlowCookieExpired = errors.New("flow cookie expired")
	errFlowIDMismatch    = errors.New("flow id does not match cookie")
	errFlowCompleted     = errors.New("flow already completed")
)

func (h *Handler) CreateFlow(ctx context.Context, req *api.CreateFlowRequest) (api.CreateFlowRes, error) {
	purpose, err := domain.FlowDefinitionPurposeString(string(req.Purpose))
	if err != nil {
		return &api.ErrorDetails{
			Code:    "invalid_purpose",
			Message: fmt.Sprintf("unknown purpose %q", req.Purpose),
		}, nil
	}

	resolveReq := service.ResolveFlowRequest{
		ProjectID: string(req.ProjectID),
		Purpose:   purpose,
		Hint:      buildResolveHint(req.Hint),
	}
	if name, ok := req.FlowDefinitionName.Get(); ok {
		resolveReq.Name = &name
	}
	if v, ok := req.SchemaVersion.Get(); ok {
		resolveReq.SchemaVersion = &v
	}
	if id, ok := req.AuthRequestID.Get(); ok {
		resolveReq.AuthRequestID = &id
	}

	def, err := h.flowService.Resolve(ctx, resolveReq)
	if err != nil {
		return errorResponse(err), nil
	}

	startReq := service.StartFlowRequest{
		Definition: def,
		Purpose:    purpose,
	}
	if uri, ok := req.RedirectURI.Get(); ok {
		// TODO: validate against RP's redirect_uri allowlist when OIDC lands.
		s := uri.String()
		startReq.RedirectURI = &s
	}
	if id, ok := req.AuthRequestID.Get(); ok {
		startReq.AuthRequestID = &id
	}
	if id, ok := req.SessionID.Get(); ok {
		startReq.SessionID = &id
	}

	result, err := h.flowService.Start(ctx, startReq)
	if err != nil {
		return mapFlowErrorStatus(err), nil
	}

	cookieValue, err := h.sealState(result.State)
	if err != nil {
		return internalErrorResponse(err), nil
	}

	resp := h.buildFlowResponse(result, false)
	return &api.FlowResponseHeaders{
		SetCookie: api.NewOptString(flowSetCookie(cookieValue, false)),
		Response:  resp,
	}, nil
}

func (h *Handler) SubmitFlowStep(ctx context.Context, req *api.FlowSubmitRequest, params api.SubmitFlowStepParams) (api.SubmitFlowStepRes, error) {
	state, err := h.openState(params.Zflow)
	if err != nil {
		return mapFlowErrorStatus(err), nil
	}
	if state.ID != params.ID {
		return mapFlowErrorStatus(errFlowIDMismatch), nil
	}

	submitReq := service.SubmitFlowRequest{
		State:  state,
		Action: req.Action,
	}
	if fields, ok := req.Fields.Get(); ok {
		decoded, err := decodeFlowFields(fields)
		if err != nil {
			return errorResponseWithStatusCode(http.StatusBadRequest, domain.ErrRequestInvalid().WithMessage(err.Error())), nil
		}
		submitReq.Fields = decoded
	}
	if proofs, ok := req.GateProofs.Get(); ok {
		submitReq.GateProofs = proofs
	}
	if id, ok := req.SSOProviderID.Get(); ok {
		submitReq.SSOProviderID = &id
	}
	if cr, ok := req.ChallengeResponse.Get(); ok {
		var proof []byte
		if p, ok := cr.Proof.Get(); ok {
			b, err := json.Marshal(p)
			if err != nil {
				return errorResponseWithStatusCode(http.StatusBadRequest, domain.ErrRequestInvalid().WithMessage("invalid challenge_response proof")), nil
			}
			proof = b
		}
		submitReq.ChallengeResponse = &domain.FlowChallengeResponse{
			ChallengeID: cr.ChallengeID.Value,
			Method:      cr.Method.Value,
			Proof:       proof,
		}
	}
	// The browser Origin header drives the WebAuthn relying-party params when a
	// step issues or verifies a passkey challenge. Same-origin browser fetches may
	// not include Origin; fall back to the effective request host injected by the
	// WithRequestHostMiddleware (X-Forwarded-Host or r.Host).
	originStr := ""
	if origin, ok := params.Origin.Get(); ok {
		originStr = origin.String()
	} else if h, ok := requestOriginFromContext(ctx); ok {
		originStr = h
	}
	if originStr != "" {
		originURL, err := url.Parse(originStr)
		if err == nil {
			if rp := passkeyRPFromOrigin(*originURL); rp != nil {
				project, err := h.projectService.Get(ctx, state.ProjectID)
				if err != nil {
					return internalErrorResponse(err), nil
				}
				if err := validateOriginAgainstProject(originStr, project); err != nil {
					return errorResponseWithStatusCode(http.StatusBadRequest,
						domain.ErrRequestInvalid().WithMessage(err.Error())), nil
				}
				submitReq.PasskeyRP = rp
			}
		}
	}

	result, err := h.flowService.Submit(ctx, submitReq)
	if err != nil {
		return mapFlowErrorStatus(err), nil
	}

	cookieValue, err := h.sealState(result.State)
	if err != nil {
		return internalErrorResponse(err), nil
	}

	terminal := result.Step != nil && result.Step.Complete != nil
	flowResp := h.buildFlowResponse(result, terminal)

	// Validation error: state machine keeps the user on the step with Error set.
	if result.Step != nil && result.Step.Error != nil {
		return &api.SubmitFlowStepBadRequest{
			SetCookie: api.NewOptString(flowSetCookie(cookieValue, false)),
			Response:  flowResp,
		}, nil
	}

	return &api.SubmitFlowStepOK{
		SetCookie: api.NewOptString(flowSetCookie(cookieValue, terminal)),
		Response:  flowResp,
	}, nil
}

func (h *Handler) GetFlowStep(ctx context.Context, params api.GetFlowStepParams) (api.GetFlowStepRes, error) {
	state, err := h.openState(params.Zflow)
	if err != nil {
		return mapFlowGetError(err), nil
	}
	if state.ID != params.ID {
		return mapFlowGetError(errFlowIDMismatch), nil
	}

	result, err := h.flowService.GetStep(ctx, service.GetFlowStepRequest{State: state})
	if err != nil {
		return errorResponse(err), nil
	}
	if result.Step != nil && result.Step.Complete != nil {
		return mapFlowGetError(errFlowCompleted), nil
	}

	resp := h.buildFlowResponse(result, false)
	return &resp, nil
}

func (h *Handler) openState(raw string) (*domain.FlowState, error) {
	if raw == "" {
		return nil, errFlowCookieMissing
	}
	payload, err := h.crypter.Decrypt(raw)
	if err != nil {
		return nil, errFlowCookieInvalid
	}
	var state domain.FlowState
	if err := json.Unmarshal([]byte(payload), &state); err != nil {
		return nil, errFlowCookieInvalid
	}
	if time.Since(state.IssuedAt) > flowCookieMaxAgeSeconds*time.Second {
		return nil, errFlowCookieExpired
	}
	return &state, nil
}

func (h *Handler) sealState(state *domain.FlowState) (string, error) {
	payload, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("marshal flow state: %w", err)
	}
	return h.crypter.Encrypt(string(payload))
}

func flowSetCookie(value string, clear bool) string {
	c := &http.Cookie{
		Name:     flowCookieName,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		// Path=/ ensures that each Set-Cookie replaces the previous one in
		// the browser's cookie jar rather than accumulating — without an
		// explicit path the browser derives the path from the request URI,
		// which differs across /flow and /flow/{id}/submit endpoints.
		Path: "/",
	}
	if clear {
		c.MaxAge = -1 // emits "Max-Age=0", instructing browsers to delete
		return c.String()
	}
	c.Value = value
	c.MaxAge = flowCookieMaxAgeSeconds
	return c.String()
}

func (h *Handler) buildFlowResponse(result service.FlowStepResult, terminal bool) api.FlowResponse {
	resp := api.FlowResponse{
		ID:        result.State.ID,
		SessionID: result.State.SessionID,
		Step:      toFlowStep(result.Step),
		Branding:  api.NewOptBranding(defaultBranding()),
	}
	if terminal && result.State.RedirectURI != nil {
		if u, err := parseURI(*result.State.RedirectURI); err == nil {
			resp.RedirectURI = api.NewOptURI(u)
		}
	}
	if terminal && result.HandoffToken != "" {
		resp.HandoffToken = api.NewOptString(result.HandoffToken)
		resp.HandoffTokenExpiresAt = api.NewOptDateTime(result.HandoffTokenExpiresAt)
	}
	return resp
}

func toFlowStep(step *domain.FlowStep) api.FlowStep {
	if step == nil {
		return api.FlowStep{}
	}
	out := api.FlowStep{
		Name:    step.Name,
		Texts:   api.NewOptStepTexts(toStepTexts(step.Texts)),
		Fields:  toFlowStepFields(step.Fields),
		Actions: toFlowStepActions(step.Actions),
		Gates:   api.FlowStepGates{},
	}
	if step.Error != nil {
		out.Error = api.NewOptNilString(*step.Error)
	}
	if step.Complete != nil {
		out.Complete = api.NewOptFlowStepComplete(toFlowStepComplete(*step.Complete))
	}
	if step.RedirectURL != nil {
		if u, err := parseURI(*step.RedirectURL); err == nil {
			out.RedirectURL = api.NewOptURI(u)
		}
	}
	if step.Challenge != nil {
		out.Challenge = api.NewOptFlowStepChallenge(toFlowStepChallenge(*step.Challenge))
	}
	return out
}

// toFlowStepChallenge maps a pending domain ceremony into the API step's
// challenge object. Options carries the protocol options JSON (for passkey,
// PublicKeyCredentialRequestOptions) verbatim for the browser.
func toFlowStepChallenge(c domain.FlowStepChallenge) api.FlowStepChallenge {
	out := api.FlowStepChallenge{}
	if c.Method != "" {
		out.Method = api.NewOptFlowStepChallengeMethod(api.FlowStepChallengeMethod(c.Method))
	}
	if c.ChallengeID != "" {
		out.ChallengeID = api.NewOptString(c.ChallengeID)
	}
	if len(c.Options) > 0 {
		var opts api.FlowStepChallengeOptions
		if err := json.Unmarshal(c.Options, &opts); err == nil {
			out.Options = api.NewOptFlowStepChallengeOptions(opts)
		}
	}
	return out
}

// validateOriginAgainstProject returns an error if the origin is not in the
// project's PreviewOrigins allowlist. An empty allowlist means allow all
// (development/test mode).
func validateOriginAgainstProject(originStr string, project *domain.Project) error {
	if len(project.PreviewOrigins) == 0 {
		return nil
	}
	for _, allowed := range project.PreviewOrigins {
		if allowed == originStr {
			return nil
		}
	}
	return fmt.Errorf("origin %q is not allowed for this project", originStr)
}


// passkeyRPFromOrigin derives the WebAuthn relying-party id (the origin host,
// without port) and the allowed origin from the browser Origin header. Returns
// nil when the origin has no host.
func passkeyRPFromOrigin(origin url.URL) *domain.FlowPasskeyRP {
	if origin.Hostname() == "" {
		return nil
	}
	return &domain.FlowPasskeyRP{
		RPID:    origin.Hostname(),
		Origins: []string{origin.String()},
	}
}

func toStepTexts(t domain.FlowStepTexts) api.StepTexts {
	out := api.StepTexts{}
	if t.TitleKey != "" {
		out.TitleKey = api.NewOptString(t.TitleKey)
	}
	if t.DescriptionKey != "" {
		out.DescriptionKey = api.NewOptNilString(t.DescriptionKey)
	}
	return out
}

func toFlowStepFields(fields map[string]domain.FlowField) api.FlowStepFields {
	out := make(api.FlowStepFields, len(fields))
	for name, f := range fields {
		out[name] = toFlowField(f)
	}
	return out
}

func toFlowField(f domain.FlowField) api.Field {
	out := api.Field{
		Type:     api.FieldType(f.Type),
		TextKey:  f.TextKey,
		Required: api.NewOptBool(f.Required),
	}
	if f.Value != nil {
		out.Value = jx.Raw(jsonQuoted(*f.Value))
	}
	if v := toFlowFieldValidation(f.Validation); v != nil {
		out.Validation = api.NewOptFieldValidation(*v)
	}
	return out
}

// flowFieldValidationFormats maps the resolver's pass-through format
// strings (sourced from the user meta-schema's `format` enum) to the
// generated OpenAPI enum. Strings not in this map are dropped at the
// mapper rather than violating the regenerated enum.
var flowFieldValidationFormats = map[string]api.FieldValidationFormat{
	"email":     api.FieldValidationFormatEmail,
	"date-time": api.FieldValidationFormatDateTime,
	"uuid":      api.FieldValidationFormatUUID,
	"uri":       api.FieldValidationFormatURI,
}

func toFlowFieldValidation(v *domain.FlowFieldValidation) *api.FieldValidation {
	if v == nil {
		return nil
	}
	out := api.FieldValidation{}
	if format, ok := flowFieldValidationFormats[v.Format]; ok {
		out.Format = api.NewOptFieldValidationFormat(format)
	}
	if v.MinLength > 0 {
		out.MinLength = api.NewOptInt(v.MinLength)
	}
	if v.MaxLength > 0 {
		out.MaxLength = api.NewOptInt(v.MaxLength)
	}
	if !out.Format.Set && !out.MinLength.Set && !out.MaxLength.Set {
		return nil
	}
	return &out
}

func toFlowStepActions(actions map[string]domain.FlowAction) api.FlowStepActions {
	out := make(api.FlowStepActions, len(actions))
	for name, a := range actions {
		out[name] = api.StepAction{
			TextKey: api.NewOptString(a.TextKey),
			Primary: api.NewOptBool(a.Primary),
		}
	}
	return out
}

func toFlowStepComplete(c domain.FlowStepComplete) api.FlowStepComplete {
	switch c {
	case domain.FlowStepCompleteRedirect:
		return api.FlowStepCompleteRedirect
	case domain.FlowStepCompleteShow:
		return api.FlowStepCompleteShow
	}
	return api.FlowStepCompleteShow
}

func decodeFlowFields(raw map[string]jx.Raw) (map[string]any, error) {
	out := make(map[string]any, len(raw))
	for k, v := range raw {
		var decoded any
		if err := json.Unmarshal(v, &decoded); err != nil {
			return nil, fmt.Errorf("decode field %q: %w", k, err)
		}
		out[k] = decoded
	}
	return out, nil
}

func jsonQuoted(s string) []byte {
	b, _ := json.Marshal(s)
	return b
}

// isCookieOrIDError matches any sentinel that means "this caller isn't
// holding a valid flow handle for this path" — either the cookie was
// missing/tampered/expired, or its embedded id doesn't match the path.
func isCookieOrIDError(err error) bool {
	return errors.Is(err, errFlowCookieMissing) ||
		errors.Is(err, errFlowCookieInvalid) ||
		errors.Is(err, errFlowCookieExpired) ||
		errors.Is(err, errFlowIDMismatch)
}

func mapFlowErrorStatus(err error) *api.ErrorDetailsStatusCode {
	switch {
	case errors.Is(err, errFlowCookieMissing), errors.Is(err, errFlowCookieInvalid):
		return errorResponseWithStatusCode(http.StatusUnauthorized,
			domain.Error{Code: "flow_cookie_invalid", Message: "flow cookie is missing or invalid"})
	case errors.Is(err, errFlowCookieExpired):
		return errorResponseWithStatusCode(http.StatusUnauthorized,
			domain.Error{Code: "flow_cookie_expired", Message: "flow cookie has expired"})
	case errors.Is(err, errFlowIDMismatch):
		return errorResponseWithStatusCode(http.StatusNotFound,
			domain.Error{Code: "flow_not_found", Message: "flow id does not match cookie"})
	case errors.Is(err, errFlowCompleted):
		return errorResponseWithStatusCode(http.StatusGone,
			domain.Error{Code: "flow_completed", Message: "flow has already completed"})
	case errors.Is(err, domain.ErrInvalidAction):
		return errorResponseWithStatusCode(http.StatusBadRequest,
			domain.Error{Code: "invalid_action", Message: err.Error()})
	case errors.Is(err, domain.ErrSessionConflict):
		return errorResponseWithStatusCode(http.StatusConflict,
			domain.Error{Code: "session_conflict", Message: err.Error()})
	case errors.Is(err, domain.ErrUnsupported):
		return errorResponseWithStatusCode(http.StatusBadRequest,
			domain.Error{Code: "unsupported", Message: err.Error()})
	}
	return errorResponse(err)
}

func mapFlowGetError(err error) api.GetFlowStepRes {
	switch {
	case isCookieOrIDError(err):
		notFound := api.GetFlowStepNotFound{Code: "flow_not_found", Message: "flow not found"}
		return &notFound
	case errors.Is(err, errFlowCompleted):
		gone := api.GetFlowStepGone{Code: "flow_completed", Message: "flow has already completed"}
		return &gone
	}
	return errorResponse(err)
}

func buildResolveHint(opt api.OptFlowHint) service.ResolveFlowHint {
	h, ok := opt.Get()
	if !ok {
		return service.ResolveFlowHint{}
	}
	out := service.ResolveFlowHint{}
	if v, ok := h.AppID.Get(); ok {
		out.AppID = &v
	}
	if v, ok := h.TeamID.Get(); ok {
		out.TeamID = &v
	}
	if v, ok := h.UserSchemaID.Get(); ok {
		out.UserSchemaID = &v
	}
	return out
}

var (
	codeFlowDefinitionNotFound        = domain.ErrFlowDefinitionNotFound().Code
	codeFlowDefinitionPurposeMismatch = domain.ErrFlowDefinitionPurposeMismatch().Code
	codeFlowDefinitionInvalid         = domain.ErrFlowDefinitionInvalid(nil, nil).Code
)

func flowDefinitionErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case codeFlowDefinitionNotFound:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case codeFlowDefinitionPurposeMismatch, codeFlowDefinitionInvalid:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	default:
		return internalErrorResponse(err)
	}
}

func parseURI(s string) (url.URL, error) {
	u, err := url.Parse(s)
	if err != nil {
		return url.URL{}, err
	}
	return *u, nil
}
