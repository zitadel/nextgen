package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/zitadel/nextgen/api/client"
	api "github.com/zitadel/nextgen/internal/api/generated"
)

// legacyPrimaryTargetsDeprecatedSince is the day createDeployment's `targets`
// became `"primary"` or a list of preview URLs, the date the Deprecation
// header of a request that still sends `["primary"]` names.
//
// TODO(#1616): the date of the release that ships the new shape; this one
// holds its place.
var legacyPrimaryTargetsDeprecatedSince = time.Date(2026, time.November, 5, 0, 0, 0, 0, time.UTC)

// legacyPrimaryTargetsDocs is the page the Link of such a response points at:
// the API reference on deployments.
const legacyPrimaryTargetsDocs = client.DocsOrigin + "/docs/reference/api/deployments"

// maxLegacyTargetsBody bounds how much of a createDeployment body is read to
// look for the old shape; a larger body reaches the operation as it came.
const maxLegacyTargetsBody = 1 << 20

var (
	// A structured-field date: @ and the seconds since the epoch (RFC 9745 §2).
	legacyPrimaryTargetsDeprecation = "@" + strconv.FormatInt(legacyPrimaryTargetsDeprecatedSince.Unix(), 10)
	legacyPrimaryTargetsLink        = "<" + legacyPrimaryTargetsDocs + `>; rel="deprecation"; type="text/html"`
	// legacyPrimaryTargets is the old shape for every primary origin, which
	// the new one spells as the bare string.
	legacyPrimaryTargets = []string{"primary"}
)

// withLegacyPrimaryTargets lets createDeployment take `targets: ["primary"]`,
// the shape every CLI and test kit released before `targets` became `"primary"`
// or a list of preview URLs sends (ADR 085), as `"primary"`. Its answer says
// the shape is deprecated (RFC 9745) with a Link to the docs, as the root path
// alias's does (ADR 077 §4), and it is accepted until 1.0.0 as that alias is.
// Any other request reaches the operation untouched.
func withLegacyPrimaryTargets(next Router) Router {
	return legacyTargetsRouter{next}
}

type legacyTargetsRouter struct{ Router }

func (l legacyTargetsRouter) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if route, ok := l.FindPath(r.Method, r.URL); ok && route.Name() == api.CreateDeploymentOperation && rewriteLegacyPrimaryTargets(r) {
		// The root path alias may have named its own, earlier, date.
		if w.Header().Get("Deprecation") == "" {
			w.Header().Set("Deprecation", legacyPrimaryTargetsDeprecation)
		}
		w.Header().Add("Link", legacyPrimaryTargetsLink)
	}
	l.Router.ServeHTTP(w, r)
}

// rewriteLegacyPrimaryTargets replaces a JSON body whose `targets` is exactly
// `["primary"]` with the same body holding `"primary"`, and reports whether it
// did. Any other body is put back as it came, for the operation to decode and
// refuse as it would have.
func rewriteLegacyPrimaryTargets(r *http.Request) bool {
	if r.Body == nil || r.Body == http.NoBody {
		return false
	}
	original := r.Body
	read, err := io.ReadAll(io.LimitReader(original, maxLegacyTargetsBody+1))
	body, rewritten := legacyPrimaryTargetsBody(read)
	if err != nil || len(read) > maxLegacyTargetsBody || !rewritten {
		r.Body = struct {
			io.Reader
			io.Closer
		}{io.MultiReader(bytes.NewReader(read), original), original}
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))
	r.Header.Set("Content-Length", strconv.Itoa(len(body)))
	return true
}

// legacyPrimaryTargetsBody is raw with `targets` spelled `"primary"`, when raw
// is a JSON object whose `targets` is `["primary"]`.
func legacyPrimaryTargetsBody(raw []byte) ([]byte, bool) {
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return nil, false
	}
	var targets []string
	if json.Unmarshal(fields["targets"], &targets) != nil || !slices.Equal(targets, legacyPrimaryTargets) {
		return nil, false
	}
	fields["targets"] = json.RawMessage(`"primary"`)
	body, err := json.Marshal(fields)
	if err != nil {
		return nil, false
	}
	return body, true
}
