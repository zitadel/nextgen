package harness

import "testing"

// TestNamingIsAnchored: the convention must match the whole name. A prefix or
// substring test would take these lookalikes for the harness's own.
func TestNamingIsAnchored(t *testing.T) {
	for name, want := range map[string]bool{
		"bench-local":             true,
		"bench-sqlite-2":          true,
		"bench":                   false,
		"bench-":                  false,
		"xbench-local":            false,
		"bench-local-":            false,
		"bench-Local":             false,
		"bench-local ":            false,
		"bench-local\nproduction": false,
		"my-bench-local":          false,
		"production":              false,
	} {
		if got := OwnsProjectName(name); got != want {
			t.Errorf("OwnsProjectName(%q) = %t, want %t", name, got, want)
		}
	}
	for email, want := range map[string]bool{
		"bench@bench.local":                true,
		"bench-user-00001@bench.local":     true,
		"real.person@example.com":          false,
		"bench@bench.local.example.com":    false,
		"bench@bench.localx":               false,
		"x@sub.bench.local":                false,
		"bench@bench.local\nreal@corp.com": false,
		"@bench.local":                     false,
		"Bench@bench.local":                false,
	} {
		if got := OwnsEmail(email); got != want {
			t.Errorf("OwnsEmail(%q) = %t, want %t", email, got, want)
		}
	}
	for n := range 3 {
		if email := PopulationEmail(n + 1); !OwnsEmail(email) {
			t.Errorf("PopulationEmail(%d) = %q does not follow the convention", n+1, email)
		}
	}
}

// TestLoadFixtureRejectsNamesCleanCouldNotRemove: a fixture that does not
// follow the convention could be provisioned but never cleaned up.
func TestLoadFixtureRejectsNamesCleanCouldNotRemove(t *testing.T) {
	dir := t.TempDir()
	write := func(body string) string {
		path := dir + "/fx.json"
		if err := osWriteFile(path, body); err != nil {
			t.Fatal(err)
		}
		return path
	}
	if _, err := LoadFixture(write(`{"project":{"name":"production","preview_origins":["http://a"]},"user":{"email":"bench@bench.local","password":"p"}}`)); err == nil {
		t.Error("project name outside the convention was accepted")
	}
	if _, err := LoadFixture(write(`{"project":{"name":"bench-x","preview_origins":["http://a"]},"user":{"email":"me@example.com","password":"p"}}`)); err == nil {
		t.Error("user email outside the convention was accepted")
	}
	if _, err := LoadFixture(write(`{"project":{"name":"bench-x","preview_origins":["http://a"]},"user":{"email":"bench@bench.local","password":"p"},"population":{"count":-1}}`)); err == nil {
		t.Error("negative population was accepted")
	}
	if _, err := LoadFixture(write(`{"project":{"name":"bench-x","preview_origins":["http://a"]},"user":{"email":"bench@bench.local","password":"p"},"population":{"count":5}}`)); err != nil {
		t.Errorf("valid fixture rejected: %v", err)
	}
}
