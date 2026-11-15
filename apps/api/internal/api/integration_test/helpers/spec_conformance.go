//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"

	"github.com/zitadel/nextgen/api/client"
	internalapi "github.com/zitadel/nextgen/internal/api"
)

// SpecValidator checks what the server under test answers against an OpenAPI
// document: the status is declared for the operation, the content type is
// one it declares, the declared headers and the body validate. A request that
// names no operation must be answered 404 or 405. A mismatch happens on a
// server goroutine, so it is recorded and CheckSpecConformance reports them.
type SpecValidator struct {
	router routers.Router

	mutex     sync.Mutex
	findings  map[findingKey]*specFinding
	unmatched map[string]int
	checked   int
}

type findingKey struct {
	operation string
	status    int
	reason    string
}

type specFinding struct {
	example string
	count   int
}

// NewSpecValidator loads an OpenAPI document, the bundle for the harness.
func NewSpecValidator(document []byte) (*SpecValidator, error) {
	doc, err := openapi3.NewLoader().LoadFromData(document)
	if err != nil {
		return nil, fmt.Errorf("load the OpenAPI document: %w", err)
	}
	// Match the paths as written: the server answers each operation under
	// client.PathPrefix and, until 1.0.0, at the root (ADR 077); Check strips
	// the prefix itself.
	doc.Servers = nil
	router, err := gorillamux.NewRouter(doc)
	if err != nil {
		return nil, fmt.Errorf("route the OpenAPI document: %w", err)
	}
	return &SpecValidator{router: router, findings: map[findingKey]*specFinding{}, unmatched: map[string]int{}}, nil
}

// Wrap records every exchange next goes through and checks it.
func (v *SpecValidator) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recorder := &specRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)
		v.record(r, recorder.statusCode(), recorder.Header(), recorder.body.Bytes())
	})
}

func (v *SpecValidator) record(r *http.Request, status int, header http.Header, body []byte) {
	operation, err := v.check(r, status, header, body)
	v.mutex.Lock()
	defer v.mutex.Unlock()
	v.checked++
	switch {
	case err == nil:
	case errors.Is(err, errNoOperation):
		v.unmatched[r.Method+" "+r.URL.Path]++
	default:
		key := findingKey{operation, status, err.Error()}
		finding := v.findings[key]
		if finding == nil {
			finding = &specFinding{example: fmt.Sprintf("%s %s: %s", r.Method, r.URL.RequestURI(), snippet(body))}
			v.findings[key] = finding
		}
		finding.count++
	}
}

// errNoOperation: no operation matches, and the server said so.
var errNoOperation = errors.New("no operation matches")

// check validates one exchange and names its operation ("" when none
// matches).
func (v *SpecValidator) check(r *http.Request, status int, header http.Header, body []byte) (string, error) {
	match := r.Clone(context.Background())
	// Until 1.0.0 the flow operations answer at `/flow` too (ADR 077 §4): an
	// answer there is checked as the operation's at `/flows`.
	if target, ok := internalapi.LegacyFlowPathTarget(match.URL); ok {
		match.URL = target
	}
	// The router matches the escaped path: an ID with an escaped slash, such
	// as a schema's URL, is one segment.
	match.URL.Path, match.URL.RawPath = stripPathPrefix(match.URL.Path), stripPathPrefix(match.URL.RawPath)
	route, params, err := v.router.FindRoute(match)
	if err != nil {
		if status == http.StatusNotFound || status == http.StatusMethodNotAllowed {
			return "", errNoOperation
		}
		return "", fmt.Errorf("%s %s names no operation in the spec, yet the server answered %d", r.Method, r.URL.Path, status)
	}
	operation := route.Operation.OperationID
	responses := route.Operation.Responses
	response := responses.Status(status)
	if response == nil && status >= http.StatusBadRequest {
		// Every operation's default is its generated error set: it covers
		// an error status, never a success or a redirect.
		response = responses.Default()
	}
	if response == nil {
		return operation, fmt.Errorf("status %d is not declared", status)
	}
	// kin lets a body through on a status that declares none.
	if len(response.Value.Content) == 0 && len(body) > 0 {
		return operation, fmt.Errorf("status %d declares no body, yet one came (%s)", status, header.Get("Content-Type"))
	}
	options := &openapi3filter.Options{
		IncludeResponseStatus:   true,
		MultiError:              true,
		SchemaValidationOptions: []openapi3.SchemaValidationOption{openapi3.WithStringFormatValidator("uri", uriFormat)},
	}
	// The reason and where, without kin's dumps of the schema and value.
	options.WithCustomSchemaErrorFunc(func(err *openapi3.SchemaError) string {
		reason := strings.Join(strings.Fields(err.Reason), " ")
		if _, rest, ok := strings.Cut(reason, "' - "); ok && strings.HasPrefix(reason, "jsonschema validation failed") {
			reason = rest // the JSON Schema 2020-12 validator's, which names the path
		}
		if pointer := err.JSONPointer(); len(pointer) > 0 && !strings.HasPrefix(reason, "at '") {
			return "at '/" + strings.Join(pointer, "/") + "': " + reason
		}
		return reason
	})
	input := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{Request: match, PathParams: params, Route: route},
		Status:                 status,
		Header:                 header,
		Options:                options,
	}
	input.SetBodyBytes(body)
	if err := openapi3filter.ValidateResponse(context.Background(), input); err != nil {
		return operation, errors.New(strings.Join(strings.Fields(err.Error()), " "))
	}
	return operation, nil
}

// uriFormat holds `format: uri` to RFC 3986's absolute URI: kin checks only
// the formats it is given, and knows no uri.
var uriFormat = openapi3.NewCallbackValidator(func(value string) error {
	parsed, err := url.Parse(value)
	if err != nil {
		return err
	}
	if !parsed.IsAbs() {
		return fmt.Errorf("%q is not an absolute URI", value)
	}
	return nil
})

// CheckSpecConformance reports every mismatch the run recorded; nil means
// the run conformed.
func (v *SpecValidator) CheckSpecConformance() error {
	v.mutex.Lock()
	defer v.mutex.Unlock()
	if len(v.findings) == 0 {
		return nil
	}
	problems := make([]string, 0, len(v.findings))
	for key, finding := range v.findings {
		operation := key.operation
		if operation == "" {
			operation = "(no operation)"
		}
		problems = append(problems, fmt.Sprintf("%s %d (%d×): %s\n    e.g. %s", operation, key.status, finding.count, key.reason, finding.example))
	}
	slices.Sort(problems)
	return fmt.Errorf("%d of the server's answers do not match the OpenAPI spec. Fix the handler, or the spec under api/openapi and regenerate (turbo run generate --filter=@zitadel/server):\n  %s",
		len(problems), strings.Join(problems, "\n  "))
}

// Summary says how many exchanges the run checked, for the end-of-run log.
func (v *SpecValidator) Summary() string {
	v.mutex.Lock()
	defer v.mutex.Unlock()
	requests := make([]string, 0, len(v.unmatched))
	for request := range v.unmatched {
		requests = append(requests, request)
	}
	slices.Sort(requests)
	return fmt.Sprintf("spec conformance: %d exchanges checked; requests for no operation, answered 404/405: %v", v.checked, requests)
}

func stripPathPrefix(path string) string {
	if path == client.PathPrefix {
		return "/"
	}
	if rest, ok := strings.CutPrefix(path, client.PathPrefix+"/"); ok {
		return "/" + rest
	}
	return path
}

func snippet(body []byte) string {
	const limit = 300
	s := strings.Join(strings.Fields(string(body)), " ")
	if len(s) > limit {
		return s[:limit] + "…"
	}
	return s
}

// specRecorder passes the response through and keeps a copy of it.
type specRecorder struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (r *specRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *specRecorder) Write(p []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	r.body.Write(p)
	return r.ResponseWriter.Write(p)
}

func (r *specRecorder) statusCode() int {
	if r.status == 0 {
		return http.StatusOK
	}
	return r.status
}

// Unwrap lets http.ResponseController reach the real writer.
func (r *specRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

func (r *specRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
