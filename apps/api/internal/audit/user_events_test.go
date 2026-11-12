package audit_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// userEventsHeading opens the catalog section that lists the event types
// whose emitters set user_id.
const userEventsHeading = "### The user an event concerns"

// emitterDirs are the packages that emit Path B events, from the repository
// root.
var emitterDirs = []string{
	"apps/api/internal/service",
	"apps/api/internal/bootstrap/platform",
}

// variableTypeEmitters names, for each function that emits with a type it was
// handed, the types it is called with.
var variableTypeEmitters = map[string][]string{
	"SetSSOCallbackResult":   {"auth.sso.authorization.failed", "auth.sso.exchange.failed", "auth.sso.exchange.succeeded"},
	"emitAuthCheck":          {"auth.check.failed", "auth.check.succeeded"},
	"emitOperatorEvent":      {"authz.granted", "authz.revoked"},
	"emitIDPConnectionEvent": {"idp.created", "idp.updated"},
	"emitPolicyEvent":        {"policy.created", "policy.updated"},
}

// manualEmitter is the one function that builds its event without an
// EmitSpec, and the types it writes.
const manualEmitter = "emitManagedGrant"

var manualEmitterTypes = []string{"authz.granted", "authz.revoked"}

// An event names the user it concerns in user_id, whoever acted, so that
// GET /events?user_id= finds everything that happened to one account. The
// catalog lists the types that do; every emitter of one sets UserID, and no
// emitter of another does.
func TestUserEventsSetUserID(t *testing.T) {
	t.Parallel()
	_, filename, _, ok := runtime.Caller(0)
	require.True(t, ok)
	root := filepath.Clean(filepath.Join(filepath.Dir(filename), "../../../.."))

	listed := catalogUserEventTypes(t, root)
	require.NotEmpty(t, listed, "the catalog lists no type under %q", userEventsHeading)
	constants := eventTypeConstants(t, root)

	emitted := map[string]bool{}
	fset := token.NewFileSet()
	for _, dir := range emitterDirs {
		entries, err := os.ReadDir(filepath.Join(root, dir))
		require.NoError(t, err)
		for _, entry := range entries {
			name := entry.Name()
			if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
				continue
			}
			file, err := parser.ParseFile(fset, filepath.Join(root, dir, name), nil, 0)
			require.NoError(t, err)
			for _, decl := range file.Decls {
				fn, ok := decl.(*ast.FuncDecl)
				if !ok || fn.Body == nil {
					continue
				}
				checkEmitter(t, fset, fn, constants, listed, emitted)
			}
		}
	}

	for eventType := range listed {
		assert.Truef(t, emitted[eventType], "the catalog lists %q under %q, and no emitter of it was found", eventType, userEventsHeading)
	}
}

// checkEmitter holds every event fn emits to the catalog's list.
func checkEmitter(t *testing.T, fset *token.FileSet, fn *ast.FuncDecl, constants map[string]string, listed, emitted map[string]bool) {
	t.Helper()
	name := fn.Name.Name
	assignsUserID := false
	buildsByHand := false
	ast.Inspect(fn.Body, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.AssignStmt:
			for _, lhs := range n.Lhs {
				if sel, ok := lhs.(*ast.SelectorExpr); ok && sel.Sel.Name == "UserID" {
					assignsUserID = true
				}
			}
		case *ast.CallExpr:
			if isSelector(n.Fun, "audit", "FromContext") {
				buildsByHand = true
			}
		case *ast.CompositeLit:
			if !isSelector(n.Type, "audit", "EmitSpec") {
				return true
			}
			at := fset.Position(n.Pos())
			types, setsUserID := emitSpecTypes(n, constants)
			if types == nil {
				types = variableTypeEmitters[name]
				if !assert.NotEmptyf(t, types, "%s: %s emits with a type it was handed; name the types in variableTypeEmitters", at, name) {
					return true
				}
			}
			for _, eventType := range types {
				emitted[eventType] = true
				if listed[eventType] {
					assert.Truef(t, setsUserID, "%s: %s emits %q without UserID; the catalog lists it under %q", at, name, eventType, userEventsHeading)
				} else {
					assert.Falsef(t, setsUserID, "%s: %s sets UserID on %q; list the type in the catalog under %q", at, name, eventType, userEventsHeading)
				}
			}
		}
		return true
	})

	if !buildsByHand {
		return
	}
	at := fset.Position(fn.Pos())
	if !assert.Equalf(t, manualEmitter, name, "%s: %s builds an event without an EmitSpec; emit through audit.Emit", at, name) {
		return
	}
	for _, eventType := range manualEmitterTypes {
		emitted[eventType] = true
		assert.Equalf(t, listed[eventType], assignsUserID, "%s: %s and the catalog disagree on user_id for %q", at, name, eventType)
	}
}

// emitSpecTypes reads an EmitSpec literal: the event type its Type names, nil
// when Type is not a domain constant, and whether it has a UserID.
func emitSpecTypes(lit *ast.CompositeLit, constants map[string]string) (types []string, setsUserID bool) {
	for _, element := range lit.Elts {
		pair, ok := element.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		key, ok := pair.Key.(*ast.Ident)
		if !ok {
			continue
		}
		switch key.Name {
		case "UserID":
			setsUserID = true
		case "Type":
			if sel, ok := pair.Value.(*ast.SelectorExpr); ok {
				if eventType, ok := constants[sel.Sel.Name]; ok {
					types = []string{eventType}
				}
			}
		}
	}
	return types, setsUserID
}

func isSelector(expr ast.Expr, pkg, name string) bool {
	sel, ok := expr.(*ast.SelectorExpr)
	if !ok || sel.Sel.Name != name {
		return false
	}
	ident, ok := sel.X.(*ast.Ident)
	return ok && ident.Name == pkg
}

// catalogUserEventTypes is the event types the catalog lists, in the list
// items of its section on the user an event concerns.
func catalogUserEventTypes(t *testing.T, root string) map[string]bool {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(root, "docs/design/api/events-catalog.md"))
	require.NoError(t, err)
	_, section, found := strings.Cut(string(raw), userEventsHeading+"\n")
	require.True(t, found, "the catalog has no section %q", userEventsHeading)
	if next := strings.Index(section, "\n#"); next >= 0 {
		section = section[:next]
	}

	eventType := regexp.MustCompile("`([a-z][a-z0-9_]*\\.[a-z0-9_.]+)`")
	listed := map[string]bool{}
	inItem := false
	for _, line := range strings.Split(section, "\n") {
		switch {
		case strings.HasPrefix(line, "- "):
			inItem = true
		case !strings.HasPrefix(line, "  "):
			inItem = false
		}
		if !inItem {
			continue
		}
		for _, match := range eventType.FindAllStringSubmatch(line, -1) {
			listed[match[1]] = true
		}
	}
	return listed
}

// eventTypeConstants maps the names of the domain's EventType constants to
// their values, read from the source so that a new one needs no entry here.
func eventTypeConstants(t *testing.T, root string) map[string]string {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), filepath.Join(root, "apps/api/internal/domain/event.go"), nil, 0)
	require.NoError(t, err)
	constants := map[string]string{}
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.CONST {
			continue
		}
		for _, spec := range gen.Specs {
			value, ok := spec.(*ast.ValueSpec)
			if !ok || len(value.Names) != 1 || len(value.Values) != 1 {
				continue
			}
			if typ, ok := value.Type.(*ast.Ident); !ok || typ.Name != "EventType" {
				continue
			}
			lit, ok := value.Values[0].(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				continue
			}
			unquoted, err := strconv.Unquote(lit.Value)
			require.NoError(t, err)
			constants[value.Names[0].Name] = unquoted
		}
	}
	require.NotEmpty(t, constants)
	return constants
}
