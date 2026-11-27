// Package securityheaders sets the response headers that tell a browser how
// to treat what the server sends: never sniff a type, never frame a page,
// keep paths out of cross-origin referrers, and which code a page may run
// (Content-Security-Policy). It also takes the violation reports those
// policies ask browsers to send (Report).
package securityheaders

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"regexp"
	"strings"
)

// The two policy headers: a browser enforces the first and only reports what
// the second would have blocked, so a policy is tried as report-only before
// it is enforced.
const (
	PolicyHeader           = "Content-Security-Policy"
	ReportOnlyPolicyHeader = "Content-Security-Policy-Report-Only"
)

// ReportPath is where a page's policy has browsers post its violations
// (Report). It is a browser's path, outside the API.
const ReportPath = "/csp-report"

// resourcePolicy is the policy of every response that is not a page: the
// API's JSON, a redirect, a document. It may load nothing, and nothing may
// frame it.
const resourcePolicy = "default-src 'none'; frame-ancestors 'none'"

// Middleware sets the headers every response of the server carries, before
// next runs: a handler that serves a page replaces the policy with the
// page's own (internal/errorpage, the console). On the hosted cloud the edge
// sets these shared headers for every service as well (repo-root vercel.json).
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		header.Set("X-Content-Type-Options", "nosniff")
		header.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		// frame-ancestors' predecessor, for the responses whose policy a
		// browser does not read and for browsers that read neither.
		header.Set("X-Frame-Options", "DENY")
		// None of our pages needs these devices; leave passkeys and the
		// clipboard available to the login and console.
		header.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		header.Set(PolicyHeader, resourcePolicy)
		next.ServeHTTP(w, r)
	})
}

// Policy joins directives into one policy, skipping empty ones.
func Policy(directives ...string) string {
	kept := directives[:0:0]
	for _, directive := range directives {
		if directive = strings.TrimSpace(directive); directive != "" {
			kept = append(kept, directive)
		}
	}
	return strings.Join(kept, "; ")
}

// Hash is the source expression that allows one inline <script> or <style>
// element by its exact text.
func Hash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
}

var (
	scriptElement = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script\s*>`)
	srcAttribute  = regexp.MustCompile(`(?i)(^|\s)src\s*=`)
)

// InlineScriptHashes hashes every inline <script> of page, a script without a
// src attribute, in document order. page is HTML the server ships, never a
// response it renders from a request.
func InlineScriptHashes(page string) []string {
	var hashes []string
	for _, match := range scriptElement.FindAllStringSubmatch(page, -1) {
		if srcAttribute.MatchString(match[1]) {
			continue
		}
		hashes = append(hashes, Hash(match[2]))
	}
	return hashes
}
