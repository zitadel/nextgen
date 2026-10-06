package harness

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// fakeTarget is a server holding one project and some users, recording the
// deletes and revokes it receives.
type fakeTarget struct {
	mu          sync.Mutex
	projectName string
	users       map[string]string // id -> email
	deleted     []string
	revoked     []string
}

func (f *fakeTarget) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch {
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/projects/"):
		id := strings.TrimPrefix(r.URL.Path, "/projects/")
		fmt.Fprintf(w, `{"id":%q,"name":%q,"preview_origins":["http://localhost:3000"],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}`, id, f.projectName)
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/users/"):
		id := strings.TrimPrefix(r.URL.Path, "/users/")
		email, ok := f.users[id]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, `{"code":"user.not_found","message":"no such user"}`)
			return
		}
		fmt.Fprintf(w, `{"id":%q,"schema":"s","attributes":{"email":%q},"metadata":{"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","status":"active"}}`, id, email)
	case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/users/"):
		id := strings.TrimPrefix(r.URL.Path, "/users/")
		f.deleted = append(f.deleted, id)
		delete(f.users, id)
		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/sessions/"):
		f.revoked = append(f.revoked, strings.TrimPrefix(r.URL.Path, "/sessions/"))
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
}

func fakeManifest(base string, users ...ManifestUser) Manifest {
	return Manifest{
		Version:  ManifestVersion,
		Target:   Target{Base: base, ProjectID: "proj_1", ProjectSecret: "s", Origin: "http://localhost:3000"},
		Project:  ManifestProject{ID: "proj_1", Name: "bench-local"},
		Users:    users,
		Sessions: []string{"sess_1"},
	}
}

// TestCleanNeverTouchesWhatIsNotOurs: the manifest alone is a file anyone can
// edit and the naming convention alone matches lookalikes, so a user is
// removed only when both agree with what the target holds.
func TestCleanNeverTouchesWhatIsNotOurs(t *testing.T) {
	target := &fakeTarget{
		projectName: "bench-local",
		users: map[string]string{
			"user_ours":      "bench@bench.local",
			"user_pop":       "bench-user-00001@bench.local",
			"user_real":      "real.person@example.com",      // manifest lists it, convention does not match
			"user_swapped":   "someone.else@bench.local",     // convention matches, manifest recorded another address
			"user_notlisted": "bench-user-00002@bench.local", // convention matches, manifest does not list it
		},
	}
	srv := httptest.NewServer(target)
	defer srv.Close()

	m := fakeManifest(srv.URL,
		ManifestUser{ID: "user_ours", Email: "bench@bench.local", Primary: true},
		ManifestUser{ID: "user_pop", Email: "bench-user-00001@bench.local"},
		ManifestUser{ID: "user_real", Email: "real.person@example.com"},
		ManifestUser{ID: "user_swapped", Email: "bench-user-00009@bench.local"},
		ManifestUser{ID: "user_gone", Email: "bench-user-00003@bench.local"},
	)
	path := filepath.Join(t.TempDir(), "manifest.json")

	plan, err := PlanClean(t.Context(), m)
	if err != nil {
		t.Fatal(err)
	}
	if len(target.deleted)+len(target.revoked) != 0 {
		t.Fatalf("planning changed the target: deleted %v revoked %v", target.deleted, target.revoked)
	}
	actions := map[string]Action{}
	for _, it := range plan.Items {
		actions[it.Kind+"/"+it.ID] = it.Action
	}
	want := map[string]Action{
		"session/sess_1":    ActionRevoke,
		"project/proj_1":    ActionRetain,
		"user/user_ours":    ActionDelete,
		"user/user_pop":     ActionDelete,
		"user/user_real":    ActionRetain,
		"user/user_swapped": ActionRetain,
		"user/user_gone":    ActionGone,
	}
	for k, a := range want {
		if actions[k] != a {
			t.Errorf("%s: %q, want %q", k, actions[k], a)
		}
	}
	if len(actions) != len(want) {
		t.Errorf("plan has %d items, want %d: %v", len(actions), len(want), actions)
	}

	left, err := ApplyClean(t.Context(), path, m, plan)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(target.deleted); got != 2 {
		t.Errorf("deleted %v, want exactly user_ours and user_pop", target.deleted)
	}
	for _, id := range target.deleted {
		if id != "user_ours" && id != "user_pop" {
			t.Errorf("deleted %s, which is not ours", id)
		}
	}
	if len(target.revoked) != 1 || target.revoked[0] != "sess_1" {
		t.Errorf("revoked %v", target.revoked)
	}
	for _, id := range []string{"user_real", "user_swapped", "user_notlisted"} {
		if _, ok := target.users[id]; !ok {
			t.Errorf("%s no longer exists", id)
		}
	}
	// The manifest keeps what was retained and drops what is gone.
	if len(left.Users) != 2 || len(left.Sessions) != 0 || left.Project.ID != "proj_1" {
		t.Errorf("manifest after clean: %+v", left)
	}
	onDisk, err := LoadManifest(path)
	if err != nil || len(onDisk.Users) != 2 {
		t.Errorf("saved manifest: %+v, %v", onDisk, err)
	}
}

// TestCleanRefusesAForeignProject: a manifest pointing at a project that is
// not ours must not be followed to its users.
func TestCleanRefusesAForeignProject(t *testing.T) {
	target := &fakeTarget{projectName: "production", users: map[string]string{"user_1": "bench@bench.local"}}
	srv := httptest.NewServer(target)
	defer srv.Close()

	_, err := PlanClean(t.Context(), fakeManifest(srv.URL, ManifestUser{ID: "user_1", Email: "bench@bench.local"}))
	if err == nil {
		t.Fatal("a project outside the convention was planned for cleaning")
	}
}

func TestCountUsersPages(t *testing.T) {
	pages := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		pages++
		if pages == 1 {
			fmt.Fprint(w, `{"users":[{"id":"user_1","schema":"s","attributes":{},"metadata":{"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","status":"active"}},{"id":"user_2","schema":"s","attributes":{},"metadata":{"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","status":"active"}}],"next_page_token":"next"}`)
			return
		}
		fmt.Fprint(w, `{"users":[{"id":"user_3","schema":"s","attributes":{},"metadata":{"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","status":"active"}}]}`)
	}))
	defer srv.Close()

	n, err := CountUsers(context.Background(), fakeManifest(srv.URL))
	if err != nil || n != 3 || pages != 2 {
		t.Errorf("CountUsers = %d, %v after %d pages", n, err, pages)
	}
}
