//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"

	"github.com/zitadel/nextgen/api/client"
	openapibundled "github.com/zitadel/nextgen/api/openapi/bundled"
	"github.com/zitadel/nextgen/internal/api"
)

// SpecValidator checks what the server under test answers against the bundled
// OpenAPI document, the contract of record: the status is declared for the
// operation, the content type is one it declares, and the body validates
// against its schema. A request that names no operation must be answered
// with 404 or 405. Each mismatch is recorded, not failed on the spot, since
// it happens on a server goroutine: CheckSpecConformance reports them all.
type SpecValidator struct {
	doc    *openapi3.T
	router routers.Router
	// outside matches the mounts that are not API operations by design.
	outside *http.ServeMux
	known   map[knownKey]KnownSpecMismatch

	mutex    sync.Mutex
	findings map[findingKey]*specFinding
	// seen counts the exchanges of each known mismatch's operation and
	// status, and mismatched those that still mismatched.
	seen       map[knownKey]int
	mismatched map[knownKey]int
	unmatched  map[string]int
	checked    int
}

// KnownSpecMismatch is an operation whose answer with Status does not match
// the spec, and why. The validator skips it; CheckSpecConformance fails once
// the run sees it answer to the spec, so the list only shrinks.
type KnownSpecMismatch struct {
	Operation string
	Status    int
	Reason    string
}

type knownKey struct {
	operation string
	status    int
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

// NewSpecValidator loads the bundled OpenAPI document. known lists the
// mismatches the run tolerates.
func NewSpecValidator(known []KnownSpecMismatch) (*SpecValidator, error) {
	loader := openapi3.NewLoader()
	data, err := io.ReadAll(openapibundled.Reader())
	if err != nil {
		return nil, err
	}
	doc, err := loader.LoadFromData(data)
	if err != nil {
		return nil, fmt.Errorf("load the bundled OpenAPI document: %w", err)
	}
	// Match the paths as written: the server answers each operation under
	// client.PathPrefix and, until 1.0.0, at the root (ADR 077); Check strips
	// the prefix itself.
	doc.Servers = nil
	router, err := gorillamux.NewRouter(doc)
	if err != nil {
		return nil, fmt.Errorf("route the bundled OpenAPI document: %w", err)
	}
	outside := http.NewServeMux()
	for _, pattern := range []string{
		openapibundled.Path,            // the document itself
		api.IDPCallbackPattern,         // a browser lands on it from the IdP
		api.IDPCallbackUpstreamPattern, // the same, behind the proxy
	} {
		outside.Handle(pattern, http.NotFoundHandler())
	}
	v := &SpecValidator{
		doc:        doc,
		router:     router,
		outside:    outside,
		known:      map[knownKey]KnownSpecMismatch{},
		findings:   map[findingKey]*specFinding{},
		seen:       map[knownKey]int{},
		mismatched: map[knownKey]int{},
		unmatched:  map[string]int{},
	}
	for _, entry := range known {
		key := knownKey{entry.Operation, entry.Status}
		if _, dup := v.known[key]; dup {
			return nil, fmt.Errorf("known spec mismatch %s %d is listed twice", entry.Operation, entry.Status)
		}
		v.known[key] = entry
	}
	return v, nil
}

// Wrap records every exchange next goes through and checks it.
func (v *SpecValidator) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recorder := &specRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)
		v.Record(r, recorder.statusCode(), recorder.Header(), recorder.body.Bytes())
	})
}

// Record checks one exchange and keeps what does not match the spec.
func (v *SpecValidator) Record(r *http.Request, status int, header http.Header, body []byte) {
	operation, err := v.Check(r, status, header, body)
	v.mutex.Lock()
	defer v.mutex.Unlock()
	v.checked++
	if errors.Is(err, errOutsideSpec) {
		return
	}
	if errors.Is(err, errNoOperation) {
		v.unmatched[r.Method+" "+r.URL.Path]++
		return
	}
	key := knownKey{operation, status}
	if _, ok := v.known[key]; ok {
		v.seen[key]++
		if err != nil {
			v.mismatched[key]++
		}
		return
	}
	if err == nil {
		return
	}
	reason := err.Error()
	fkey := findingKey{operation, status, reason}
	finding := v.findings[fkey]
	if finding == nil {
		finding = &specFinding{example: fmt.Sprintf("%s %s: %s", r.Method, r.URL.RequestURI(), snippet(body))}
		v.findings[fkey] = finding
	}
	finding.count++
}

var (
	// errOutsideSpec: the request is for a mount that is no API operation.
	errOutsideSpec = errors.New("not an API operation")
	// errNoOperation: no operation matches, and the server said so.
	errNoOperation = errors.New("no operation matches")
)

// Check validates one exchange and names its operation ("" when none
// matches). It returns errOutsideSpec, errNoOperation, or the mismatch.
func (v *SpecValidator) Check(r *http.Request, status int, header http.Header, body []byte) (string, error) {
	if _, pattern := v.outside.Handler(r); pattern != "" {
		return "", errOutsideSpec
	}
	match := r.Clone(context.Background())
	match.URL.Path = stripPathPrefix(r.URL.Path)
	// The router matches the escaped path: an ID with an escaped slash, such
	// as a schema's URL, is one segment.
	match.URL.RawPath = stripPathPrefix(r.URL.RawPath)
	route, params, err := v.router.FindRoute(match)
	if err != nil {
		if status == http.StatusNotFound || status == http.StatusMethodNotAllowed {
			return "", errNoOperation
		}
		return "", fmt.Errorf("%s %s names no operation in the spec, yet the server answered %d", r.Method, r.URL.Path, status)
	}
	operation := route.Operation.OperationID
	if r.Method == http.MethodHead {
		return operation, nil
	}
	responses := route.Operation.Responses
	responseRef := responses.Status(status)
	if responseRef == nil && status >= http.StatusBadRequest {
		// Every operation's default is its generated error set: it covers
		// an error status, never a success or a redirect.
		responseRef = responses.Default()
	}
	if responseRef == nil {
		return operation, fmt.Errorf("status %d is not declared", status)
	}
	if len(responseRef.Value.Content) == 0 {
		if len(body) > 0 {
			return operation, fmt.Errorf("status %d declares no body, yet one came (%s)", status, header.Get("Content-Type"))
		}
		return operation, validateHeaders(match, route, params, status, header, body)
	}
	if responseRef.Value.Content.Get(header.Get("Content-Type")) == nil {
		return operation, fmt.Errorf("content type %q is not declared for status %d", header.Get("Content-Type"), status)
	}
	input := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{
			Request:    match,
			PathParams: params,
			Route:      route,
		},
		Status: status,
		Header: header,
		Options: &openapi3filter.Options{
			IncludeResponseStatus: true,
			MultiError:            true,
		},
	}
	input.SetBodyBytes(body)
	if err := openapi3filter.ValidateResponse(context.Background(), input); err != nil {
		return operation, flatten(err)
	}
	return operation, nil
}

// validateHeaders runs kin's response validation for a status without a
// body, which checks only the declared headers.
func validateHeaders(r *http.Request, route *routers.Route, params map[string]string, status int, header http.Header, body []byte) error {
	input := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{Request: r, PathParams: params, Route: route},
		Status:                 status,
		Header:                 header,
		Options:                &openapi3filter.Options{IncludeResponseStatus: true, MultiError: true},
	}
	input.SetBodyBytes(body)
	if err := openapi3filter.ValidateResponse(context.Background(), input); err != nil {
		return flatten(err)
	}
	return nil
}

// CheckSpecConformance reports every mismatch the run recorded, and every
// known mismatch the run saw answer to the spec. nil means the run conformed.
func (v *SpecValidator) CheckSpecConformance() error {
	v.mutex.Lock()
	defer v.mutex.Unlock()
	var problems []string
	keys := make([]findingKey, 0, len(v.findings))
	for key := range v.findings {
		keys = append(keys, key)
	}
	slices.SortFunc(keys, func(a, b findingKey) int {
		return strings.Compare(fmt.Sprint(a.operation, a.status, a.reason), fmt.Sprint(b.operation, b.status, b.reason))
	})
	for _, key := range keys {
		finding := v.findings[key]
		problems = append(problems, fmt.Sprintf("%s %d (%d×): %s\n    e.g. %s", orUnmatched(key.operation), key.status, finding.count, key.reason, finding.example))
	}
	for key, entry := range v.known {
		if v.seen[key] > 0 && v.mismatched[key] == 0 {
			problems = append(problems, fmt.Sprintf("%s %d now matches the spec in all %d exchanges: remove it from the known spec mismatches (%s)", key.operation, key.status, v.seen[key], entry.Reason))
		}
	}
	if len(problems) == 0 {
		return nil
	}
	return fmt.Errorf("%d of the server's answers do not match the OpenAPI spec (helpers/spec_mismatches.go lists the known ones):\n  %s",
		len(problems), strings.Join(problems, "\n  "))
}

// Summary says how many exchanges the run checked, for the end-of-run log.
func (v *SpecValidator) Summary() string {
	v.mutex.Lock()
	defer v.mutex.Unlock()
	unmatched := 0
	requests := make([]string, 0, len(v.unmatched))
	for request, n := range v.unmatched {
		unmatched += n
		requests = append(requests, request)
	}
	slices.Sort(requests)
	tolerated := 0
	for _, n := range v.mismatched {
		tolerated += n
	}
	return fmt.Sprintf("spec conformance: %d exchanges checked, %d known mismatches tolerated, %d requests for no operation answered 404/405 %v",
		v.checked, tolerated, unmatched, requests)
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

// flatten turns kin's errors into one line: the reason of each cause and
// where in the body it is, without the schema and value dumps.
func flatten(err error) error {
	return errors.New(describe(err))
}

func describe(err error) string {
	var multi openapi3.MultiError
	var response *openapi3filter.ResponseError
	var schema *openapi3.SchemaError
	switch {
	case errors.As(err, &response):
		if response.Err == nil {
			return response.Reason
		}
		return response.Reason + ": " + describe(response.Err)
	case errors.As(err, &multi):
		parts := make([]string, 0, len(multi))
		for _, e := range multi {
			parts = append(parts, describe(e))
		}
		slices.Sort(parts)
		return strings.Join(slices.Compact(parts), "; ")
	case errors.As(err, &schema):
		if schema.Origin != nil {
			return describe(schema.Origin)
		}
		reason := schema.Reason
		if reason == "" {
			reason = "does not match " + schema.SchemaField
		}
		if pointer := schema.JSONPointer(); len(pointer) > 0 && !strings.Contains(reason, "at '/") {
			reason = "at '/" + strings.Join(pointer, "/") + "': " + reason
		}
		return reason
	}
	message, _, _ := strings.Cut(err.Error(), " Schema:")
	message = strings.Join(strings.Fields(message), " ")
	// A oneOf branch's error names its path twice.
	if _, rest, ok := strings.Cut(message, `": at '/`); ok && strings.HasPrefix(message, `error at "`) {
		message = "at '/" + rest
	}
	return message
}

func orUnmatched(operation string) string {
	if operation == "" {
		return "(no operation)"
	}
	return operation
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
