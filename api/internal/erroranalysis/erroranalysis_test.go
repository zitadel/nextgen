package erroranalysis

import (
	"errors"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
)

// analyzeOnce runs the analysis over this module once for the whole package.
// A run is a packages.Load of the module plus a walk of every service and
// handler method; giving each test its own would multiply that by the number of
// tests for results that cannot differ between them.
var analyzeOnce = sync.OnceValues(func() (map[string]Method, error) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return nil, errors.New("cannot resolve test file path")
	}
	return Analyze(Config{Dir: filepath.Join(filepath.Dir(file), "../../..")})
})

func analyzeRepo(t *testing.T) map[string]Method {
	t.Helper()
	methods, err := analyzeOnce()
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

// fixturePkg is the import path of the testdata module the shape tests analyze.
// It stands apart from the real tree so a shape can be pinned without waiting
// for the production code to grow one.
const fixturePkg = "github.com/zitadel/nextgen/api/internal/erroranalysis/testdata/fixture/"

var analyzeFixtureOnce = sync.OnceValues(func() (map[string]Method, error) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return nil, errors.New("cannot resolve test file path")
	}
	return Analyze(Config{
		Dir:           filepath.Join(filepath.Dir(file), "../../.."),
		Patterns:      []string{"./api/internal/erroranalysis/testdata/fixture/..."},
		ModulePrefix:  fixturePkg,
		DomainPkgPath: fixturePkg + "domain",
		EntryPkgPath:  fixturePkg + "service",
	})
})

func analyzeFixture(t *testing.T) map[string]Method {
	t.Helper()
	methods, err := analyzeFixtureOnce()
	if err != nil {
		t.Fatalf("Analyze fixture: %v", err)
	}
	return methods
}

func fixtureErrors(t *testing.T, method string) []string {
	t.Helper()
	m, ok := analyzeFixture(t)["FixtureService."+method]
	if !ok {
		t.Fatalf("FixtureService.%s: not analyzed", method)
	}
	return m.Errors
}

// TestErrorsAsPropagatesThroughItsTarget covers the unwrap shapes the
// production tree happens not to use. errors.AsType hands the error to its
// first result; errors.As hands it to a pointer argument instead, so binding
// the assignment's first LHS would bind the bool and drop the codes — and the
// bare `if errors.As(err, &target)` form has no assignment to bind at all. A
// stray errors.As in a service path would then silently shrink an operation's
// spec, which is the client decode failure this analysis exists to prevent.
func TestErrorsAsPropagatesThroughItsTarget(t *testing.T) {
	for _, name := range []string{"AsPointerTarget", "AsInCondition", "AsTypeFirstResult"} {
		if got := fixtureErrors(t, name); !slices.Contains(got, "domain.ErrFixtureInner") {
			t.Errorf("%s: unwrapped error dropped, got %v", name, got)
		}
	}
}

// TestMutualRecursionDoesNotPoisonTheCache pins the guard on caching an
// under-approximated result. While MutualA is active, mutualB's call back into
// it contributes nothing, so mutualB's set is missing A's error — right for
// that walk, but permanent if cached, and MutualB would inherit it.
func TestMutualRecursionDoesNotPoisonTheCache(t *testing.T) {
	for _, name := range []string{"MutualA", "MutualB"} {
		got := fixtureErrors(t, name)
		for _, want := range []string{"domain.ErrFixtureA", "domain.ErrFixtureB"} {
			if !slices.Contains(got, want) {
				t.Errorf("%s: missing %s, got %v", name, want, got)
			}
		}
	}
}

// TestHandlerAuthzGatePropagatesResourceAccessErrors pins the call-site path
// this PR relies on: Handler methods call requireProjectAccess with a package
// resourceAccess row, the Handler wrapper forwards that row into the package
// helper, and miss/denied select func-typed fields. Losing any hop drops
// permission_denied / not_found from the generated OpenAPI oneOf.
func TestHandlerAuthzGatePropagatesResourceAccessErrors(t *testing.T) {
	methods := analyzeRepo(t)

	cases := map[string][]string{
		"Handler.GetBrandingById": {
			"domain.ErrBrandingNotFound",
			"domain.ErrBrandingPermissionDenied",
		},
		"Handler.CreateBranding": {
			"domain.ErrBrandingPermissionDenied",
		},
		"Handler.QueryUsers": {
			"domain.ErrUserNotFound",
			"domain.ErrUserPermissionDenied",
		},
	}
	for key, want := range cases {
		method, ok := methods[key]
		if !ok {
			t.Errorf("%s: not analyzed", key)
			continue
		}
		for _, code := range want {
			if !slices.Contains(method.Errors, code) {
				t.Errorf("%s: missing %s (got %v)", key, code, method.Errors)
			}
		}
	}
}

// TestDumpAnalysis is a reporting aid, not a test: go test -run TestDump -v
// prints every analyzed method so the inferred sets can be eyeballed against
// the spec. It asserts nothing, so it stays out of the way of a plain run.
func TestDumpAnalysis(t *testing.T) {
	if !testing.Verbose() {
		t.Skip("reporting aid; run with -v to print the inferred error sets")
	}

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
