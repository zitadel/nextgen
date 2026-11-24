package flowengine

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The handoff is minted in completeFlow alone, and routeOutcome alone reaches
// it, so every completion passes the one point.
func TestCompleteFlow_IsTheOnlyCompletionPoint(t *testing.T) {
	t.Parallel()
	callers := callersIn(t, ".")
	assert.Equal(t, []string{"completeFlow"}, callers["Handoff"])
	assert.Equal(t, []string{"routeOutcome"}, callers["completeFlow"])
}

// callersIn maps each called method or function name to the functions of the
// package's non-test files that call it.
func callersIn(t *testing.T, dir string) map[string][]string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	fset := token.NewFileSet()
	callers := map[string][]string{}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, filepath.Join(dir, name), nil, 0)
		require.NoError(t, err)
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				switch fun := call.Fun.(type) {
				case *ast.SelectorExpr:
					callers[fun.Sel.Name] = append(callers[fun.Sel.Name], fn.Name.Name)
				case *ast.Ident:
					callers[fun.Name] = append(callers[fun.Name], fn.Name.Name)
				}
				return true
			})
		}
	}
	return callers
}
