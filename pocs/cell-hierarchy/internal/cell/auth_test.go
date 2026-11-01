package cell_test

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestIssueAndAuthCheckAllowsWithGrant(t *testing.T) {
	home, us, cleanup := setupJoeAuthBase(t, true)
	defer cleanup()

	issue := postJSON(t, home, "/v1/token/issue", map[string]any{
		"project_id": "team-eu-2",
		"sub":        "joe@example.com",
		"aud":        "app:chat",
	})
	defer issue.Body.Close()
	if issue.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(issue.Body)
		t.Fatalf("issue status=%d body=%s", issue.StatusCode, body)
	}
	var issued cell.IssueTokenResponse
	decode(t, issue, &issued)
	if issued.Token == "" || issued.Claims.Sub != "joe@example.com" {
		t.Fatalf("issued=%+v", issued)
	}
	if issued.Claims.HomeProject != "team-eu-2" || issued.Claims.Epoch != 1 {
		t.Fatalf("claims=%+v", issued.Claims)
	}
	if issued.Claims.Aud != "app:chat" {
		t.Fatalf("aud=%s", issued.Claims.Aud)
	}

	check := postJSON(t, us, "/v1/auth/check", map[string]any{
		"token":      issued.Token,
		"project_id": "us",
		"object":     "app:chat",
		"relation":   "viewer",
		"online":     true,
	})
	defer check.Body.Close()
	if check.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(check.Body)
		t.Fatalf("check status=%d body=%s", check.StatusCode, body)
	}
	var auth cell.AuthCheckResponse
	decode(t, check, &auth)
	if !auth.Allowed {
		t.Fatalf("expected allowed, got reason=%s trace=%+v", auth.Reason, auth.Trace)
	}
	if auth.Claims == nil || auth.Claims.Sub != "joe@example.com" {
		t.Fatalf("claims=%+v", auth.Claims)
	}
	foundJWKS, foundPrincipal, foundGrant := false, false, false
	for _, hop := range auth.Trace {
		switch {
		case hop.Method == "GET /v1/jwks" && hop.Result == "ok":
			foundJWKS = true
		case hop.Method == "POST /v1/principal/check" && hop.Result == "active":
			foundPrincipal = true
		case hop.Method == "local grant check" && strings.HasPrefix(hop.Result, "allowed@"):
			foundGrant = true
		}
	}
	if !foundJWKS || !foundPrincipal || !foundGrant {
		t.Fatalf("trace incomplete: jwks=%v principal=%v grant=%v hops=%+v", foundJWKS, foundPrincipal, foundGrant, auth.Trace)
	}
}

func TestAuthCheckDeniesWithoutGrant(t *testing.T) {
	home, us, cleanup := setupJoeAuthBase(t, false)
	defer cleanup()

	appRes := postJSON(t, us, "/v1/projects/us/apps", map[string]any{"name": "chat"})
	defer appRes.Body.Close()

	issue := postJSON(t, home, "/v1/token/issue", map[string]any{
		"project_id": "team-eu-2", "sub": "joe@example.com", "aud": "app:chat",
	})
	defer issue.Body.Close()
	var issued cell.IssueTokenResponse
	decode(t, issue, &issued)

	check := postJSON(t, us, "/v1/auth/check", map[string]any{
		"token": issued.Token, "project_id": "us", "object": "app:chat", "relation": "viewer", "online": false,
	})
	defer check.Body.Close()
	var auth cell.AuthCheckResponse
	decode(t, check, &auth)
	if auth.Allowed {
		t.Fatal("expected deny without grant")
	}
	if auth.Reason != "grant_denied" {
		t.Fatalf("reason=%s", auth.Reason)
	}
}

func TestUnknownUserLookupMissNoChildWalk(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	us, _, c2 := startCell(t, "http://us", "us", false)
	defer c2()
	createProject(t, platform, "platform", true, true)
	createProject(t, us, "us", false, false)
	attachProject(t, us, "us", "platform", platformURL)

	res, hops, err := cell.NewPeerClient().LookupWalk(t.Context(), us.URL, "us", "nobody@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if res.Hit {
		t.Fatal("expected miss for unknown user")
	}
	for _, hop := range hops {
		if strings.Contains(strings.ToLower(hop.Method), "child") {
			t.Fatalf("unexpected child walk hop: %+v", hop)
		}
	}

	eu2, _, c3 := startCell(t, "http://eu-2", "eu-2", false)
	defer c3()
	createProject(t, eu2, "team-eu-2", false, false)
	issue := postJSON(t, eu2, "/v1/token/issue", map[string]any{
		"project_id": "team-eu-2", "sub": "nobody@example.com", "aud": "app:chat",
	})
	defer issue.Body.Close()
	if issue.StatusCode != http.StatusNotFound {
		t.Fatalf("status=%d", issue.StatusCode)
	}
	assertError(t, issue, "user_not_found")
}

func TestTamperedTokenRejected(t *testing.T) {
	home, us, cleanup := setupJoeAuthBase(t, true)
	defer cleanup()

	issue := postJSON(t, home, "/v1/token/issue", map[string]any{
		"project_id": "team-eu-2", "sub": "joe@example.com", "aud": "app:chat",
	})
	defer issue.Body.Close()
	var issued cell.IssueTokenResponse
	decode(t, issue, &issued)

	parts := strings.Split(issued.Token, ".")
	if len(parts) != 3 {
		t.Fatalf("token parts=%d", len(parts))
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatal(err)
	}
	claims["sub"] = "eve@example.com"
	tamperedPayload, _ := json.Marshal(claims)
	tampered := parts[0] + "." + base64.RawURLEncoding.EncodeToString(tamperedPayload) + "." + parts[2]

	check := postJSON(t, us, "/v1/auth/check", map[string]any{
		"token": tampered, "project_id": "us", "object": "app:chat", "relation": "viewer", "online": false,
	})
	defer check.Body.Close()
	var auth cell.AuthCheckResponse
	decode(t, check, &auth)
	if auth.Allowed {
		t.Fatal("tampered token must be rejected")
	}
	if auth.Reason != "token_signature_invalid" {
		t.Fatalf("reason=%s", auth.Reason)
	}
}

func TestJWKSPersistsAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "cell.db")
	store1, err := cell.OpenStore(dbPath, "http://home", "home", false)
	if err != nil {
		t.Fatal(err)
	}
	key1, err := store1.GetOrCreateSigningKey()
	if err != nil {
		t.Fatal(err)
	}
	_ = store1.Close()

	store2, err := cell.OpenStore(dbPath, "http://home", "home", false)
	if err != nil {
		t.Fatal(err)
	}
	defer store2.Close()
	key2, err := store2.GetOrCreateSigningKey()
	if err != nil {
		t.Fatal(err)
	}
	if string(key1.PublicKey) != string(key2.PublicKey) {
		t.Fatal("signing key must persist across reopen")
	}

	srv := cell.NewServer(store2, cell.NewPeerClient(), nil)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	rewriteMetaURL(t, store2, ts.URL)

	jwks := getJSON(t, ts, "/v1/jwks")
	defer jwks.Body.Close()
	var body cell.JWKS
	decode(t, jwks, &body)
	if len(body.Keys) != 1 || body.Keys[0].Crv != "Ed25519" {
		t.Fatalf("jwks=%+v", body)
	}
}

func setupJoeAuthBase(t *testing.T, withGrant bool) (home, us *httptest.Server, cleanup func()) {
	t.Helper()
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	eu, euURL, c2 := startCell(t, "http://eu", "eu", true)
	eu2, _, c3 := startCell(t, "http://eu-2", "eu-2", false)
	usCell, _, c4 := startCell(t, "http://us", "us", false)

	createProject(t, platform, "platform", true, true)
	createProject(t, eu, "eu", true, true)
	createProject(t, eu2, "team-eu-2", false, false)
	createProject(t, usCell, "us", false, false)
	attachProject(t, eu, "eu", "platform", platformURL)
	attachProject(t, eu2, "team-eu-2", "eu", euURL)
	attachProject(t, usCell, "us", "platform", platformURL)

	created := postJSON(t, eu2, "/v1/projects/team-eu-2/users", map[string]any{"email": "joe@example.com"})
	defer created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(created.Body)
		t.Fatalf("create joe status=%d body=%s", created.StatusCode, body)
	}

	if withGrant {
		appRes := postJSON(t, usCell, "/v1/projects/us/apps", map[string]any{"name": "chat"})
		defer appRes.Body.Close()
		grant := postJSON(t, usCell, "/v1/projects/us/tuples", map[string]any{
			"object": "app:chat", "relation": "viewer", "user_key": "joe@example.com",
		})
		defer grant.Body.Close()
		if grant.StatusCode != http.StatusCreated {
			body, _ := io.ReadAll(grant.Body)
			t.Fatalf("grant status=%d body=%s", grant.StatusCode, body)
		}
	}

	cleanup = func() { c1(); c2(); c3(); c4() }
	return eu2, usCell, cleanup
}
