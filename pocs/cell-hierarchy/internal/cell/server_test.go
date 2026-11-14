package cell_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestPrepareRejectsNonParent(t *testing.T) {
	srv, _, cleanup := startCell(t, "http://leaf", "leaf", false)
	defer cleanup()

	res := postJSON(t, srv, "/v1/join/prepare", map[string]any{})
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d", res.StatusCode)
	}
	assertError(t, res, "parent_not_accepting_children")
}

func TestJoinHappyPathAndHeartbeat(t *testing.T) {
	parent, parentURL, cleanupP := startCell(t, "http://parent", "parent", true)
	defer cleanupP()
	child, childURL, cleanupC := startCell(t, "http://child", "child", false)
	defer cleanupC()

	prep := postJSON(t, parent, "/v1/join/prepare", map[string]any{})
	defer prep.Body.Close()
	if prep.StatusCode != http.StatusOK {
		t.Fatalf("prepare status=%d", prep.StatusCode)
	}
	var invite cell.PrepareResponse
	decode(t, prep, &invite)
	if invite.JoinToken == "" || invite.ParentURL != parentURL {
		t.Fatalf("bad invite: %+v", invite)
	}

	acc := postJSON(t, child, "/v1/join/accept", cell.AcceptRequest{
		ParentURL: invite.ParentURL,
		JoinToken: invite.JoinToken,
	})
	defer acc.Body.Close()
	if acc.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(acc.Body)
		t.Fatalf("accept status=%d body=%s", acc.StatusCode, body)
	}

	children := getJSON(t, parent, "/v1/children")
	defer children.Body.Close()
	var listed struct {
		Children []struct {
			ChildURL string `json:"child_url"`
			Alive    bool   `json:"alive"`
		} `json:"children"`
	}
	decode(t, children, &listed)
	if len(listed.Children) != 1 || listed.Children[0].ChildURL != childURL {
		t.Fatalf("children=%+v", listed.Children)
	}
	if !listed.Children[0].Alive {
		t.Fatal("expected child alive after accept heartbeat")
	}

	me := getJSON(t, child, "/v1/me")
	defer me.Body.Close()
	var meBody cell.MeResponse
	decode(t, me, &meBody)
	if meBody.ParentURL != parentURL || meBody.Status != "joined" {
		t.Fatalf("me=%+v", meBody)
	}
}

func TestCompleteRejectsExpiredToken(t *testing.T) {
	dir := t.TempDir()
	store, err := cell.OpenStore(filepath.Join(dir, "p.db"), "http://parent", "parent", true)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	fixed := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	srv := cell.NewServer(store, cell.NewPeerClient(), nil)
	srv.Now = func() time.Time { return fixed }
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	rewriteMetaURL(t, store, ts.URL)

	token := "tok-expired"
	if err := store.CreateJoinToken(token, fixed.Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	res := postJSON(t, ts, "/v1/join/complete", cell.CompleteRequest{
		ChildURL:  "http://child",
		JoinToken: token,
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d", res.StatusCode)
	}
	assertError(t, res, "invalid_join_token")
}

func TestCompleteRejectsDuplicateChild(t *testing.T) {
	parent, parentURL, cleanupP := startCell(t, "http://parent", "parent", true)
	defer cleanupP()
	child, _, cleanupC := startCell(t, "http://child", "child", false)
	defer cleanupC()

	joinOnce(t, parent, child, parentURL)

	me := getJSON(t, child, "/v1/me")
	defer me.Body.Close()
	var meBody cell.MeResponse
	decode(t, me, &meBody)

	prep2 := postJSON(t, parent, "/v1/join/prepare", map[string]any{})
	defer prep2.Body.Close()
	var invite2 cell.PrepareResponse
	decode(t, prep2, &invite2)
	res2 := postJSON(t, parent, "/v1/join/complete", cell.CompleteRequest{
		ChildURL:  meBody.URL,
		JoinToken: invite2.JoinToken,
	})
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d", res2.StatusCode)
	}
	assertError(t, res2, "duplicate_child")
}

func TestCompleteRejectsCycle(t *testing.T) {
	platform, platformURL, c1 := startCell(t, "http://platform", "platform", true)
	defer c1()
	eu1, eu1URL, c2 := startCell(t, "http://eu-1", "eu-1", false)
	defer c2()

	joinOnce(t, platform, eu1, platformURL)

	// Enable parent on leaf so it can prepare, then try to complete with platform as child (cycle).
	en := postJSON(t, eu1, "/v1/admin/enable-parent", map[string]any{})
	defer en.Body.Close()
	if en.StatusCode != http.StatusOK {
		t.Fatalf("enable-parent status=%d", en.StatusCode)
	}

	prep := postJSON(t, eu1, "/v1/join/prepare", map[string]any{})
	defer prep.Body.Close()
	var invite cell.PrepareResponse
	decode(t, prep, &invite)

	meP := getJSON(t, platform, "/v1/me")
	defer meP.Body.Close()
	var platformMe cell.MeResponse
	decode(t, meP, &platformMe)

	res := postJSON(t, eu1, "/v1/join/complete", cell.CompleteRequest{
		ChildURL:  platformMe.URL,
		JoinToken: invite.JoinToken,
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("status=%d body=%s", res.StatusCode, body)
	}
	assertError(t, res, "join_would_create_cycle")
	_ = eu1URL
	_ = platformURL
}

func TestHeartbeatUnauthorized(t *testing.T) {
	parent, _, cleanup := startCell(t, "http://parent", "parent", true)
	defer cleanup()
	req, _ := http.NewRequest(http.MethodPost, parent.URL+"/v1/heartbeat", nil)
	req.Header.Set("Authorization", "Bearer nope")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status=%d", res.StatusCode)
	}
}

func startCell(t *testing.T, wantURL, label string, isParent bool) (*httptest.Server, string, func()) {
	t.Helper()
	dir := t.TempDir()
	store, err := cell.OpenStore(filepath.Join(dir, "cell.db"), wantURL, label, isParent)
	if err != nil {
		t.Fatal(err)
	}
	peer := cell.NewPeerClient()
	srv := cell.NewServer(store, peer, nil)
	ts := httptest.NewServer(srv.Handler())
	rewriteMetaURL(t, store, ts.URL)
	peer.SelfURL = cell.NormalizeURL(ts.URL)
	if peer.URLLabels == nil {
		peer.URLLabels = map[string]string{}
	}
	peer.URLLabels[cell.NormalizeURL(ts.URL)] = label
	cleanup := func() {
		ts.Close()
		_ = store.Close()
	}
	return ts, ts.URL, cleanup
}

func rewriteMetaURL(t *testing.T, store *cell.Store, url string) {
	t.Helper()
	meta, err := store.GetMeta()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateIdentity(url, meta.Label, meta.IsParent); err != nil {
		t.Fatal(err)
	}
}

func joinOnce(t *testing.T, parent, child *httptest.Server, parentURL string) {
	t.Helper()
	prep := postJSON(t, parent, "/v1/join/prepare", map[string]any{})
	defer prep.Body.Close()
	var invite cell.PrepareResponse
	decode(t, prep, &invite)
	if invite.ParentURL == "" {
		invite.ParentURL = parentURL
	}
	acc := postJSON(t, child, "/v1/join/accept", cell.AcceptRequest{
		ParentURL: invite.ParentURL,
		JoinToken: invite.JoinToken,
	})
	defer acc.Body.Close()
	if acc.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(acc.Body)
		t.Fatalf("join accept status=%d body=%s", acc.StatusCode, body)
	}
}

func postJSON(t *testing.T, ts *httptest.Server, path string, body any) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	res, err := http.Post(ts.URL+path, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func getJSON(t *testing.T, ts *httptest.Server, path string) *http.Response {
	t.Helper()
	res, err := http.Get(ts.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func deleteJSON(t *testing.T, ts *httptest.Server, path string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodDelete, ts.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func decode(t *testing.T, res *http.Response, v any) {
	t.Helper()
	if err := json.NewDecoder(res.Body).Decode(v); err != nil {
		t.Fatal(err)
	}
}

func assertError(t *testing.T, res *http.Response, want string) {
	t.Helper()
	var er struct {
		Error string `json:"error"`
	}
	decode(t, res, &er)
	if er.Error != want {
		t.Fatalf("error=%q want=%q", er.Error, want)
	}
}
