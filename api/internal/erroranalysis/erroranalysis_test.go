package erroranalysis

import (
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strings"
	"testing"
)

func moduleRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve test file path")
	}
	return filepath.Join(filepath.Dir(file), "../../..")
}

func analyzeRepo(t *testing.T) map[string]Method {
	t.Helper()
	methods, err := Analyze(Config{Dir: moduleRoot(t)})
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if len(methods) == 0 {
		t.Fatal("Analyze returned no methods")
	}
	return methods
}

// TestAnalyzeMatchesDeclaredErrors pins the inference against the hand-written
// "errors:" doc comments that predate it. Those comments were reviewed by hand
// for the auth attempt service, so they are the closest thing to ground truth
// this analysis has.
func TestAnalyzeMatchesDeclaredErrors(t *testing.T) {
	methods := analyzeRepo(t)

	want := map[string][]string{
		"AuthAttemptService.Create": {
			"domain.ErrAuthAttemptInvalidRequest",
			"domain.ErrInternal",
		},
		"AuthAttemptService.GetByID": {
			"domain.ErrAuthAttemptNotFound",
			"domain.ErrInternal",
		},
	}

	for key, expected := range want {
		method, ok := methods[key]
		if !ok {
			t.Errorf("%s: not analyzed", key)
			continue
		}
		for _, code := range expected {
			if !slices.Contains(method.Errors, code) {
				t.Errorf("%s: missing %s (got %v)", key, code, method.Errors)
			}
		}
	}
}

// TestApplyActionsDispatchIsCallSiteSensitive is the reason this analysis binds
// concrete types to interface-typed parameters. UserService.CreateUser and
// DeleteUser both funnel through ApplyActions, which calls Prepare/Apply on an
// interface. Resolved by interface alone, deleting a user would advertise the
// errors of creating one.
func TestApplyActionsDispatchIsCallSiteSensitive(t *testing.T) {
	methods := analyzeRepo(t)

	create, ok := methods["UserService.CreateUser"]
	if !ok {
		t.Fatal("UserService.CreateUser not analyzed")
	}
	del, ok := methods["UserService.DeleteUser"]
	if !ok {
		t.Fatal("UserService.DeleteUser not analyzed")
	}

	if !slices.Contains(create.Errors, "domain.ErrUserAlreadyExists") {
		t.Errorf("CreateUser: expected domain.ErrUserAlreadyExists, got %v", create.Errors)
	}
	if slices.Contains(del.Errors, "domain.ErrUserAlreadyExists") {
		t.Errorf("DeleteUser: leaked CreateUserAction's domain.ErrUserAlreadyExists: %v", del.Errors)
	}
	if slices.Contains(del.Errors, "domain.ErrUserInvalid") {
		t.Errorf("DeleteUser: leaked CreateUserAction's domain.ErrUserInvalid: %v", del.Errors)
	}
}

// TestInspectedErrorsAreNotReported guards the difference between raising an
// error and testing for one. AuthAttemptService.Create checks
// errors.Is(err, domain.ErrSessionNotFound()) and converts it — the session
// error never reaches a return.
func TestInspectedErrorsAreNotReported(t *testing.T) {
	methods := analyzeRepo(t)

	create, ok := methods["AuthAttemptService.Create"]
	if !ok {
		t.Fatal("AuthAttemptService.Create not analyzed")
	}
	if slices.Contains(create.Errors, "domain.ErrSessionNotFound") {
		t.Errorf("Create: reported an inspected-only error: %v", create.Errors)
	}
}

// TestDumpAnalysis is a reporting aid: go test -run TestDump -v prints every
// analyzed method so the inferred sets can be eyeballed against the spec.
func TestDumpAnalysis(t *testing.T) {
	methods := analyzeRepo(t)

	keys := make([]string, 0, len(methods))
	for key := range methods {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	for _, key := range keys {
		m := methods[key]
		switch {
		case m.Unimplemented:
			t.Logf("%-52s (no implementation found)", key)
		case len(m.Errors) == 0:
			t.Logf("%-52s -", key)
		default:
			t.Logf("%-52s %s", key, strings.Join(m.Errors, ", "))
		}
	}
}
