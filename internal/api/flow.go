package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-faster/jx"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	flowCookieName          = "_zflow"
	flowCookieMaxAgeSeconds = 600
)

func (h *Handler) CreateFlow(ctx context.Context, req *api.CreateFlowRequest) (api.CreateFlowRes, error) {
	audit.BindPublicRequest(ctx, string(req.ProjectID), "", "")
	purpose, err := domain.FlowDefinitionPurposeString(string(req.Purpose))
	if err != nil {
		return nil, domain.ErrFlowInvalidPurpose().WithMessage(fmt.Sprintf("unknown purpose %q", req.Purpose))
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
		return nil, err
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
	if ua, ok := middleware.UserAgentFromContext(ctx); ok {
		startReq.UserAgent = ua
	}

	result, err := h.flowService.Start(ctx, startReq)
	if err != nil {
		return nil, normalizeFlowError(err)
	}
	if result.State != nil {
		audit.BindPublicRequest(ctx, result.State.ProjectID, result.State.ID, result.State.SessionID)
	}

	cookieValue, err := h.sealState(ctx, result.State)
	if err != nil {
		return nil, err
	}

	resp := h.buildFlowResponse(ctx, result, false)
	return &api.FlowResponseHeaders{
		SetCookie: api.NewOptString(flowSetCookie(ctx, cookieValue, false)),
		Response:  resp,
	}, nil
}

func (h *Handler) SubmitFlowStep(ctx context.Context, req *api.FlowSubmitRequest, params api.SubmitFlowStepParams) (api.SubmitFlowStepRes, error) {
	state, err := h.openState(ctx, params.Zflow)
	if err != nil {
		return nil, normalizeFlowError(err)
	}
	audit.BindPublicRequest(ctx, state.ProjectID, state.ID, state.SessionID)
	if state.ID != params.ID {
		return nil, domain.ErrFlowNotFound()
	}

	submitReq := service.SubmitFlowRequest{
		State:  state,
		Action: req.Action,
	}
	if fields, ok := req.Fields.Get(); ok {
		decoded, err := decodeFlowFields(fields)
		if err != nil {
			// Safe client message; Parent keeps a log-safe wrapper that still Unwraps
			// to the json.Unmarshal cause for diagnostics (ADR 030). Field name goes
			// in structured details — never parser text or payload fragments.
			domErr := domain.ErrRequestInvalid().WithMessage(err.Error()).WithParent(err)
			if decodeErr, ok := err.(*flowFieldDecodeError); ok {
				domErr = domErr.WithDetails(domain.RequestInvalidFieldDetails{Field: decodeErr.field})
			}
			return nil, domErr
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
				return nil, domain.ErrRequestInvalid().WithMessage("invalid challenge_response proof")
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
					// A project lookup failing mid-submit is a server-side
					// fault, not client input: keep it a 500 rather than
					// letting proj.not_found surface as a 404 here.
					return nil, domain.ErrInternal(err)
				}
				if err := validateOriginAgainstProject(originStr, project); err != nil {
					return nil, domain.ErrRequestInvalid().WithMessage(err.Error())
				}
				submitReq.PasskeyRP = rp
			}
		}
	}

	result, err := h.flowService.Submit(ctx, submitReq)
	if err != nil {
		return nil, normalizeFlowError(err)
	}

	cookieValue, err := h.sealState(ctx, result.State)
	if err != nil {
		return nil, err
	}

	terminal := result.Step != nil && result.Step.Complete != nil
	flowResp := h.buildFlowResponse(ctx, result, terminal)

	// Validation error: state machine keeps the user on the step with Error set.
	if result.Step != nil && result.Step.Error != nil {
		return &api.SubmitFlowStepBadRequest{
			SetCookie: api.NewOptString(flowSetCookie(ctx, cookieValue, false)),
			Response:  flowResp,
		}, nil
	}

	return &api.SubmitFlowStepOK{
		SetCookie: api.NewOptString(flowSetCookie(ctx, cookieValue, terminal)),
		Response:  flowResp,
	}, nil
}

func (h *Handler) GetFlowStep(ctx context.Context, params api.GetFlowStepParams) (api.GetFlowStepRes, error) {
	state, err := h.openState(ctx, params.Zflow)
	if err != nil {
		return mapFlowGetError(err)
	}
	audit.BindPublicRequest(ctx, state.ProjectID, state.ID, state.SessionID)
	if state.ID != params.ID {
		return mapFlowGetError(domain.ErrFlowNotFound())
	}

	result, err := h.flowService.GetStep(ctx, service.GetFlowStepRequest{State: state})
	if err != nil {
		return nil, err
	}
	if result.Step != nil && result.Step.Complete != nil {
		return mapFlowGetError(domain.ErrFlowCompleted())
	}

	resp := h.buildFlowResponse(ctx, result, false)
	return &resp, nil
}

func (h *Handler) openState(ctx context.Context, raw string) (*domain.FlowState, error) {
	if raw == "" {
		return nil, domain.ErrFlowCookieInvalid()
	}

	header, err := domain.DecodeJWEHeader(raw)
	if err != nil {
		return nil, domain.ErrFlowCookieInvalid()
	}

	decrypter, err := h.keyService.GetCrypter(ctx, header.KeyID, header.EncryptionAlgorithm)
	if err != nil {
		var domainError domain.Error
		if errors.As(err, &domainError) && domainError.Code != domain.ErrInternal(nil).Code {
			return nil, domain.ErrFlowCookieInvalid()
		}
		return nil, err
	}

	payload, err := decrypter.Decrypt(raw)
	if err != nil {
		return nil, domain.ErrFlowCookieInvalid()
	}
	var state domain.FlowState
	if err := json.Unmarshal([]byte(payload), &state); err != nil {
		return nil, domain.ErrFlowCookieInvalid()
	}
	if time.Since(state.IssuedAt) > flowCookieMaxAgeSeconds*time.Second {
		return nil, domain.ErrFlowCookieExpired()
	}
	return &state, nil
}

func (h *Handler) sealState(ctx context.Context, state *domain.FlowState) (string, error) {
	payload, err := json.Marshal(state)
	if err != nil {
		return "", fmt.Errorf("marshal flow state: %w", err)
	}
	cookieCrypter, err := h.keyService.GetProjectCrypter(ctx, state.ProjectID, domain.EncryptionKeyPurposeCookie)
	if err != nil {
		return "", err
	}
	return cookieCrypter.Encrypt(string(payload))
}

func flowSetCookie(ctx context.Context, value string, clear bool) string {
	c := &http.Cookie{
		Name:     flowCookieName,
		HttpOnly: true,
		// Secure follows the request scheme so Safari can keep the cookie on
		// http://localhost (see cookieSecureFromContext).
		Secure:   cookieSecureFromContext(ctx),
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

// buildFlowResponse assembles the wire response for a flow step. Branding is
// resolved per response (latest revision for the project, ADR 040) so a
// published template change reaches in-flight flows on their next step.
func (h *Handler) buildFlowResponse(ctx context.Context, result domain.FlowStepResult, terminal bool) api.FlowResponse {
	resp := api.FlowResponse{
		ID:        result.State.ID,
		SessionID: result.State.SessionID,
		Step:      toFlowStep(result.Step),
		Branding:  api.NewOptBranding(h.resolveBranding(ctx, result.State.ProjectID)),
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
		switch c.Method {
		case domain.FlowChallengeMethodPasskeyRegister:
			out.Method = api.NewOptFlowStepChallengeMethod(api.FlowStepChallengeMethodPasskeyRegister)
		default:
			out.Method = api.NewOptFlowStepChallengeMethod(api.FlowStepChallengeMethodPasskey)
		}
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
//
// Matching is deliberately exact — no loopback aliasing between localhost,
// 127.0.0.1, and [::1]. The WebAuthn RP ID derives from the origin hostname
// (passkeyRPFromOrigin), so a passkey registered under one loopback spelling
// can never assert under another; aliasing here would replace this clear 400
// with a confusing "no passkey found" during the ceremony.
func validateOriginAgainstProject(originStr string, project *domain.Project) error {
	if len(project.PreviewOrigins) == 0 {
		return nil
	}
	for _, allowed := range project.PreviewOrigins {
		if allowed == originStr {
			return nil
		}
	}
	return fmt.Errorf("origin %q is not allowed for this project (allowed: %s)",
		originStr, strings.Join(project.PreviewOrigins, ", "))
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

func toFlowStepFields(fields []domain.FlowField) []api.Field {
	out := make([]api.Field, len(fields))
	for i, f := range fields {
		out[i] = toFlowField(f)
	}
	return out
}

func toFlowField(f domain.FlowField) api.Field {
	out := api.Field{
		Name:     f.Name,
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
	if len(v.Enum) > 0 {
		out.Enum = v.Enum
	}
	if !out.Format.Set && !out.MinLength.Set && !out.MaxLength.Set && len(out.Enum) == 0 {
		return nil
	}
	return &out
}

func toFlowStepActions(actions []domain.FlowAction) []api.StepAction {
	out := make([]api.StepAction, len(actions))
	for i, a := range actions {
		out[i] = api.StepAction{
			Name:    a.Name,
			Kind:    api.StepActionKind(a.Kind.String()),
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

// flowFieldDecodeError is a log-safe wrapper around a Fields value decode failure.
// By the time decodeFlowFields runs, ogen has already syntax-validated the JSON;
// failures here are typically values encoding/json cannot represent as Go any
// (for example numbers outside float64). Error() names only the field for clients;
// Unwrap preserves the json.Unmarshal cause for errors.Is/As. LogValue omits the
// cause string (it can embed payload fragments / PII).
type flowFieldDecodeError struct {
	field string
	err   error
}

func (e *flowFieldDecodeError) Error() string {
	return fmt.Sprintf("invalid value for field %q", e.field)
}

func (e *flowFieldDecodeError) Unwrap() error {
	return e.err
}

func (e *flowFieldDecodeError) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("kind", "field_value"),
		slog.String("field", e.field),
	)
}

func decodeFlowFields(raw map[string]jx.Raw) (map[string]any, error) {
	out := make(map[string]any, len(raw))
	for k, v := range raw {
		var decoded any
		if err := json.Unmarshal(v, &decoded); err != nil {
			return nil, &flowFieldDecodeError{field: k, err: err}
		}
		out[k] = decoded
	}
	return out, nil
}

func jsonQuoted(s string) []byte {
	b, _ := json.Marshal(s)
	return b
}

var (
	codeFlowCookieInvalid   = domain.ErrFlowCookieInvalid().Code
	codeFlowCookieExpired   = domain.ErrFlowCookieExpired().Code
	codeFlowNotFound        = domain.ErrFlowNotFound().Code
	codeFlowCompleted       = domain.ErrFlowCompleted().Code
	codeFlowInvalidAction   = domain.ErrFlowInvalidAction().Code
	codeFlowSessionConflict = domain.ErrFlowSessionConflict().Code
	codeFlowUnsupported     = domain.ErrFlowUnsupported().Code
	codeFlowInvalidPurpose  = domain.ErrFlowInvalidPurpose().Code
)

func flowErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case codeFlowCookieInvalid, codeFlowCookieExpired:
		return errorResponseWithStatusCode(http.StatusUnauthorized, err)
	case codeFlowNotFound:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case codeFlowCompleted:
		return errorResponseWithStatusCode(http.StatusGone, err)
	case codeFlowSessionConflict:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	case codeFlowInvalidAction, codeFlowUnsupported, codeFlowInvalidPurpose:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	default:
		return internalErrorResponse(err)
	}
}

// isCookieOrIDError matches any sentinel that means "this caller isn't
// holding a valid flow handle for this path" — either the cookie was
// missing/tampered/expired, or its embedded id doesn't match the path.
func isCookieOrIDError(err error) bool {
	return errors.Is(err, domain.ErrFlowCookieInvalid()) ||
		errors.Is(err, domain.ErrFlowCookieExpired()) ||
		errors.Is(err, domain.ErrFlowNotFound())
}

// normalizeFlowError replaces a wrapped flow sentinel with the sentinel itself,
// so the response carries its fixed public Message rather than a wrapped
// err.Error() chain (ADR 030). Non-flow errors pass through untouched.
//
// Status selection is not done here: errorResponse already routes flow-prefixed
// codes to flowErrorResponse, which is the single place that maps a flow code
// to its HTTP status.
func normalizeFlowError(err error) error {
	var domErr domain.Error
	if !errors.As(err, &domErr) || !strings.HasPrefix(domErr.Code, domain.PrefixFlow.ErrorCodePrefix("")) {
		return err
	}

	for _, sentinel := range []domain.Error{
		domain.ErrFlowCookieInvalid(),
		domain.ErrFlowCookieExpired(),
		domain.ErrFlowNotFound(),
		domain.ErrFlowCompleted(),
		domain.ErrFlowInvalidAction(),
		domain.ErrFlowSessionConflict(),
		domain.ErrFlowUnsupported(),
		domain.ErrFlowInvalidPurpose(),
	} {
		if errors.Is(err, sentinel) {
			return sentinel
		}
	}
	return domErr
}

func mapFlowGetError(err error) (api.GetFlowStepRes, error) {
	switch {
	case isCookieOrIDError(err):
		notFound := api.GetFlowStepNotFound(domainErrorDetails(domain.ErrFlowNotFound()))
		return &notFound, nil
	case errors.Is(err, domain.ErrFlowCompleted()):
		gone := api.GetFlowStepGone(domainErrorDetails(domain.ErrFlowCompleted()))
		return &gone, nil
	}
	return nil, err
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
	codeMissingFlowDefinitionID       = domain.ErrMissingFlowDefinitionID().Code
	codeMissingProjectID              = domain.ErrMissingProjectID().Code
	codeFlowDefinitionUpdateConflict  = domain.ErrFlowDefinitionUpdateConflict(nil).Code
	codeFlowDefinitionDenied          = domain.ErrFlowDefinitionPermissionDenied().Code
)

func flowDefinitionErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case codeFlowDefinitionNotFound:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case codeFlowDefinitionPurposeMismatch,
		codeMissingFlowDefinitionID,
		codeMissingProjectID:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case codeFlowDefinitionInvalid:
		return errorResponseWithDetails(err, http.StatusBadRequest)
	case codeFlowDefinitionUpdateConflict:
		return errorResponseWithDetails(err, http.StatusConflict)
	case codeFlowDefinitionDenied:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}

func errorResponseWithDetails(err domain.Error, statusCode int) *api.ErrorDetailsStatusCode {
	errResp := errorResponseWithStatusCode(statusCode, err)
	if err.Details == nil {
		return errResp
	}
	if details, ok := err.Details.(string); ok {
		b, marshalErr := json.Marshal(details)
		if marshalErr == nil {
			errResp.Response.Details = api.OptErrorDetailsDetails{
				Value: api.ErrorDetailsDetails{
					"details": b,
				},
				Set: true,
			}
		}
	}
	return errResp
}

func parseURI(s string) (url.URL, error) {
	u, err := url.Parse(s)
	if err != nil {
		return url.URL{}, err
	}
	return *u, nil
}
