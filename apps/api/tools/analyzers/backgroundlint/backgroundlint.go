// Package backgroundlint is a go/analysis analyzer behind ADR 088: what the
// server does outside a request starts through internal/background, where
// each task says what it does in a process that runs only while it serves a
// request.
//
// Nothing in Go stops a new timer or flusher from starting with a bare go
// statement, and such a task runs late or never where the process is paused
// between requests, without anything saying so. The analyzer reports what
// starts a goroutine on its own: a go statement and a call to time.AfterFunc.
//
// Exemptions:
//
//   - The sanctioned package in -sanctioned (default internal/background).
//
//   - Test files and generated files.
//
//   - A site with a directive comment that carries a reason, on the same line
//     or the line above. It names the background task the goroutine belongs
//     to, or says why the goroutine is not background work:
//
//     go j.loop() //background:allow the task "event retention"
//
//     A directive without a reason exempts nothing.
package backgroundlint

import (
	"go/ast"
	"go/token"
	"go/types"
	"strings"

	"golang.org/x/tools/go/analysis"
	"golang.org/x/tools/go/analysis/passes/inspect"
	"golang.org/x/tools/go/ast/inspector"
)

const (
	// Directive is the comment prefix that exempts one site.
	Directive = "//background:allow"

	defaultSanctioned = "github.com/zitadel/nextgen/internal/background"
)

// Analyzer is the backgroundlint analyzer.
var Analyzer = &analysis.Analyzer{
	Name:     "backgroundlint",
	Doc:      "reports goroutines started outside internal/background (ADR 088)",
	Requires: []*analysis.Analyzer{inspect.Analyzer},
	Run:      run,
}

var flagSanctioned string

func init() {
	Analyzer.Flags.StringVar(&flagSanctioned, "sanctioned", defaultSanctioned,
		"import path of the package that may start goroutines")
}

func run(pass *analysis.Pass) (any, error) {
	if pass.Pkg.Path() == flagSanctioned {
		return nil, nil
	}
	// allowLines maps a line a directive covers to its reason; an empty
	// reason is kept so the site is reported together with the defect.
	allowLines := map[*token.File]map[int]string{}
	for _, f := range pass.Files {
		file := pass.Fset.File(f.Pos())
		if strings.HasSuffix(file.Name(), "_test.go") || ast.IsGenerated(f) {
			continue
		}
		lines := map[int]string{}
		allowLines[file] = lines
		for _, group := range f.Comments {
			for _, comment := range group.List {
				reason, isDirective := directiveReason(comment.Text)
				if !isDirective {
					continue
				}
				line := pass.Fset.Position(comment.Pos()).Line
				for _, covered := range []int{line, line + 1} {
					if _, taken := lines[covered]; !taken || reason != "" {
						lines[covered] = reason
					}
				}
			}
		}
	}

	report := func(pos token.Pos, what string) {
		lines, checked := allowLines[pass.Fset.File(pos)]
		if !checked {
			return
		}
		reason, covered := lines[pass.Fset.Position(pos).Line]
		if covered && reason != "" {
			return
		}
		if covered {
			pass.Reportf(pos, "%s directive needs a reason", Directive)
		}
		pass.Reportf(pos, "%s outside internal/background: start background work as a background.Task (ADR 088), or exempt with %s <reason>", what, Directive)
	}

	insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
	insp.Preorder([]ast.Node{(*ast.GoStmt)(nil), (*ast.CallExpr)(nil)}, func(n ast.Node) {
		switch n := n.(type) {
		case *ast.GoStmt:
			report(n.Pos(), "go statement")
		case *ast.CallExpr:
			if isTimeAfterFunc(pass, n) {
				report(n.Pos(), "time.AfterFunc")
			}
		}
	})
	return nil, nil
}

func isTimeAfterFunc(pass *analysis.Pass, call *ast.CallExpr) bool {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	fn, ok := pass.TypesInfo.Uses[sel.Sel].(*types.Func)
	return ok && fn.Pkg() != nil && fn.Pkg().Path() == "time" && fn.Name() == "AfterFunc"
}

// directiveReason recognises exactly the directive followed by a space or
// the end of the comment, and returns the trimmed text after it, so
// "//background:allowed" is no directive.
func directiveReason(comment string) (reason string, ok bool) {
	if comment == Directive {
		return "", true
	}
	if rest, found := strings.CutPrefix(comment, Directive+" "); found {
		return strings.TrimSpace(rest), true
	}
	return "", false
}
