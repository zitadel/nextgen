// Package egresslint is a go/analysis analyzer that enforces the single
// egress-client invariant behind ADR 061: every outbound HTTP or TCP client
// in production code must come from internal/httputil, the hardened client
// that applies the SSRF deny list at dial time, caps redirects and body size,
// and refuses https-to-http downgrades.
//
// Go has no in-process permission model, so nothing stops a future code path
// from reaching for http.Get on a user-supplied URL. This analyzer is that
// missing guard: it is type-aware, so it catches every way of constructing a
// client (composite literal, new, zero-value declaration, the package-level
// defaults and helpers), the raw dial layer underneath (net.Dial*, tls.Dial*,
// net.Dialer, tls.Dialer), and imports of third-party HTTP clients that would
// sidestep the standard library entirely.
//
// Scope, stated plainly: the analyzer inspects the packages it is given —
// first-party code — and never the bodies of dependencies. A library that
// builds its own client internally is only caught when its import path is on
// the -third-party list. It also does not model raw sockets beyond
// syscall.Connect, process execution (curl via os/exec), or DNS-only egress
// through net.Resolver; those are network-policy concerns, not client-choice
// ones. The rule's job is to make "I need to fetch a URL" have exactly one
// obvious, reviewed answer in this codebase.
//
// Exemptions are explicit and audited:
//
//   - The sanctioned package(s) in -sanctioned (default internal/httputil)
//     are skipped entirely; that is where the raw primitives belong.
//
//   - Test files and generated files are skipped unless -check-tests or
//     -check-generated is set.
//
//   - A single site can be exempted with a directive comment carrying a
//     reason, on the same line or the line above:
//
//     //egress:allow operator-configured sink, not user-injectable (ADR 061)
//
//     A directive without a reason does not exempt anything and is itself
//     reported at the construction it was meant to cover.
//
// It ships in the tools/analyzers/cmd/analyzers bundle, which moon run
// server:lint executes; see that command for standalone and go vet usage.
package egresslint

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
	// Directive is the comment prefix that exempts one construction site.
	Directive = "//egress:allow"

	defaultSanctioned = "github.com/zitadel/nextgen/internal/httputil"
)

// defaultThirdPartyClients lists module paths of libraries that dial on their
// own and therefore bypass the hardened client: HTTP client wrappers,
// websocket clients, and gRPC. An entry matches the module root and its
// major-version variants (/v2, /v3), not arbitrary subpackages, so importing
// google.golang.org/grpc/codes to inspect an error stays allowed while
// google.golang.org/grpc itself, which dials, is reported. When gRPC egress
// becomes a sanctioned path that is a visible decision: a directive here or
// a change to this list, not a silent arrival.
var defaultThirdPartyClients = []string{
	"github.com/go-resty/resty",
	"github.com/hashicorp/go-retryablehttp",
	"github.com/imroc/req",
	"github.com/valyala/fasthttp",
	"github.com/carlmjohnson/requests",
	"github.com/levigross/grequests",
	"github.com/gojek/heimdall",
	"github.com/sethgrid/pester",
	"github.com/h2non/gentleman",
	"gopkg.in/h2non/gentleman",
	"github.com/dghubble/sling",
	"github.com/parnurzeal/gorequest",
	"github.com/gorilla/websocket",
	"github.com/coder/websocket",
	"nhooyr.io/websocket",
	"golang.org/x/net/websocket",
	"google.golang.org/grpc",
}

// forbiddenTypes are types whose construction outside the sanctioned package
// means a new egress path. Keyed by package path, then type name.
var forbiddenTypes = map[string]map[string]string{
	"net/http": {
		"Client":    "constructs an http.Client",
		"Transport": "constructs an http.Transport",
	},
	"net": {
		"Dialer": "constructs a net.Dialer",
	},
	"crypto/tls": {
		"Dialer": "constructs a tls.Dialer",
	},
}

// forbiddenFuncs are package-level functions and variables that perform or
// enable egress directly.
var forbiddenFuncs = map[string]map[string]string{
	"net/http": {
		"Get":              "calls http.Get",
		"Head":             "calls http.Head",
		"Post":             "calls http.Post",
		"PostForm":         "calls http.PostForm",
		"DefaultClient":    "uses http.DefaultClient",
		"DefaultTransport": "uses http.DefaultTransport",
	},
	"net": {
		"Dial":        "calls net.Dial",
		"DialTimeout": "calls net.DialTimeout",
		"DialIP":      "calls net.DialIP",
		"DialTCP":     "calls net.DialTCP",
		"DialUDP":     "calls net.DialUDP",
		"DialUnix":    "calls net.DialUnix",
	},
	"crypto/tls": {
		"Dial":           "calls tls.Dial",
		"DialWithDialer": "calls tls.DialWithDialer",
	},
	"syscall": {
		"Connect": "calls syscall.Connect",
		"Socket":  "calls syscall.Socket",
	},
}

// Analyzer is the egresslint analyzer.
var Analyzer = &analysis.Analyzer{
	Name:     "egresslint",
	Doc:      "reports outbound HTTP or TCP clients constructed outside the hardened egress package (ADR 061)",
	URL:      "https://github.com/zitadel/nextgen/blob/main/docs/adrs/061-egress-policy-user-injectable-urls.md",
	Requires: []*analysis.Analyzer{inspect.Analyzer},
	Run:      run,
}

var (
	flagSanctioned     string
	flagThirdParty     string
	flagCheckTests     bool
	flagCheckGenerated bool
)

func init() {
	Analyzer.Flags.StringVar(&flagSanctioned, "sanctioned", defaultSanctioned,
		"comma-separated import paths allowed to construct raw clients and dialers")
	Analyzer.Flags.StringVar(&flagThirdParty, "third-party", strings.Join(defaultThirdPartyClients, ","),
		"comma-separated module paths of third-party dialing libraries to forbid (matched with their /vN variants)")
	Analyzer.Flags.BoolVar(&flagCheckTests, "check-tests", false,
		"also check _test.go files")
	Analyzer.Flags.BoolVar(&flagCheckGenerated, "check-generated", false,
		"also check generated files")
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func run(pass *analysis.Pass) (any, error) {
	for _, sanctioned := range splitList(flagSanctioned) {
		if pass.Pkg.Path() == sanctioned || pass.Pkg.Path() == sanctioned+"_test" {
			return nil, nil
		}
	}
	thirdParty := splitList(flagThirdParty)

	insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)

	// Per-file state: whether the file is checked at all, and the lines its
	// egress:allow directives cover.
	// allowLines maps a covered line to the directive's reason; an empty
	// reason marks a directive that must be reported alongside the
	// construction it fails to exempt.
	type fileState struct {
		skip       bool
		allowLines map[int]string
	}
	states := make(map[*ast.File]*fileState, len(pass.Files))
	for _, f := range pass.Files {
		st := &fileState{allowLines: map[int]string{}}
		states[f] = st
		filename := pass.Fset.File(f.Pos()).Name()
		if !flagCheckTests && strings.HasSuffix(filename, "_test.go") {
			st.skip = true
			continue
		}
		if !flagCheckGenerated && ast.IsGenerated(f) {
			st.skip = true
			continue
		}
		for _, cg := range f.Comments {
			for _, c := range cg.List {
				reason, isDirective := directiveReason(c.Text)
				if !isDirective {
					continue
				}
				line := pass.Fset.Position(c.Pos()).Line
				// Covers a trailing directive on the same line and a
				// directive on the line directly above the construction.
				// An empty reason is stored so the construction it was
				// meant to cover is reported together with the defect.
				for _, l := range []int{line, line + 1} {
					if _, taken := st.allowLines[l]; !taken || reason != "" {
						st.allowLines[l] = reason
					}
				}
			}
		}
		for _, imp := range f.Imports {
			path := strings.Trim(imp.Path.Value, `"`)
			for _, tp := range thirdParty {
				if matchesModule(path, tp) {
					report(pass, st.allowLines, imp.Pos(), "imports third-party dialing library %q", path)
				}
			}
		}
	}

	var current *fileState
	nodeFilter := []ast.Node{
		(*ast.File)(nil),
		(*ast.CompositeLit)(nil),
		(*ast.CallExpr)(nil),
		(*ast.ValueSpec)(nil),
		(*ast.SelectorExpr)(nil),
		(*ast.TypeSpec)(nil),
		(*ast.StructType)(nil),
		(*ast.IndexExpr)(nil),
		(*ast.IndexListExpr)(nil),
	}
	insp.Preorder(nodeFilter, func(n ast.Node) {
		switch n := n.(type) {
		case *ast.File:
			current = states[n]
			return
		}
		if current == nil || current.skip {
			return
		}
		switch n := n.(type) {
		case *ast.CompositeLit:
			if what, ok := forbiddenTypeOf(pass.TypesInfo.TypeOf(n)); ok {
				report(pass, current.allowLines, n.Pos(), "%s outside the hardened egress package", what)
			}
		case *ast.CallExpr:
			// new(http.Client), make([]http.Client, n), make(map[K]http.Client):
			// every builtin allocation of a usable zero value.
			if id, ok := n.Fun.(*ast.Ident); ok && len(n.Args) >= 1 {
				if obj, isBuiltin := pass.TypesInfo.Uses[id].(*types.Builtin); isBuiltin && (obj.Name() == "new" || obj.Name() == "make") {
					if what, ok := forbiddenTypeOf(pass.TypesInfo.TypeOf(n.Args[0])); ok {
						report(pass, current.allowLines, n.Pos(), "%s via %s() outside the hardened egress package", what, obj.Name())
					}
				}
			}
			// (*http.Client)(x): a conversion from a locally defined type
			// back into the real client.
			if tv, ok := pass.TypesInfo.Types[n.Fun]; ok && tv.IsType() {
				if what, ok := forbiddenTypeOf(tv.Type); ok {
					report(pass, current.allowLines, n.Pos(), "%s by conversion outside the hardened egress package", what)
				}
			}
		case *ast.TypeSpec:
			// type mine http.Client — a defined type is a distinct named
			// type, so its literals would otherwise slip past the check.
			// Aliases (type mine = http.Client) resolve to the same object
			// and are caught at the construction site instead.
			if n.Assign == token.NoPos {
				if what, ok := forbiddenTypeOf(pass.TypesInfo.TypeOf(n.Type)); ok {
					report(pass, current.allowLines, n.Pos(), "%s as the underlying type of %s outside the hardened egress package", what, n.Name.Name)
				}
			}
		case *ast.StructType:
			// A field holding http.Client by value (named or embedded) is a
			// usable zero-value client in every instance of the struct.
			// Pointer fields are fine: they need a construction elsewhere.
			if n.Fields == nil {
				return
			}
			for _, f := range n.Fields.List {
				if _, isPtr := f.Type.(*ast.StarExpr); isPtr {
					continue
				}
				if what, ok := forbiddenTypeOf(pass.TypesInfo.TypeOf(f.Type)); ok {
					report(pass, current.allowLines, f.Pos(), "%s as a by-value struct field outside the hardened egress package", what)
				}
			}
		case *ast.IndexExpr:
			// zero[http.Client]() — explicit type argument to a generic.
			checkTypeArgs(pass, current.allowLines, []ast.Expr{n.Index})
		case *ast.IndexListExpr:
			checkTypeArgs(pass, current.allowLines, n.Indices)
		case *ast.ValueSpec:
			// var c http.Client — zero value is a usable client.
			if n.Type != nil && len(n.Values) == 0 {
				if what, ok := forbiddenTypeOf(pass.TypesInfo.TypeOf(n.Type)); ok {
					report(pass, current.allowLines, n.Pos(), "%s as a zero-value declaration outside the hardened egress package", what)
				}
			}
		case *ast.SelectorExpr:
			obj := pass.TypesInfo.Uses[n.Sel]
			if obj == nil || obj.Pkg() == nil {
				return
			}
			if _, isPkgName := pass.TypesInfo.Uses[identOf(n.X)].(*types.PkgName); !isPkgName {
				return
			}
			if what, ok := forbiddenFuncs[obj.Pkg().Path()][obj.Name()]; ok {
				report(pass, current.allowLines, n.Pos(), "%s outside the hardened egress package", what)
			}
		}
	})
	return nil, nil
}

// directiveReason recognises exactly "//egress:allow" followed by a space or
// the end of the comment, and returns the trimmed text after it. A comment
// such as "//egress:allowed ..." is not a directive: prefix matching would
// read it as one with reason "ed" and silently exempt the line.
// matchesModule reports whether path is module or one of its major-version
// variants (module/v2, module/v3, ...). Other subpackages do not match.
func matchesModule(path, module string) bool {
	if path == module {
		return true
	}
	rest, found := strings.CutPrefix(path, module+"/")
	if !found || len(rest) < 2 || rest[0] != 'v' {
		return false
	}
	for _, r := range rest[1:] {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func directiveReason(comment string) (reason string, ok bool) {
	if comment == Directive {
		return "", true
	}
	if rest, found := strings.CutPrefix(comment, Directive+" "); found {
		return strings.TrimSpace(rest), true
	}
	return "", false
}

func checkTypeArgs(pass *analysis.Pass, allowLines map[int]string, args []ast.Expr) {
	for _, a := range args {
		tv, ok := pass.TypesInfo.Types[a]
		if !ok || !tv.IsType() {
			continue
		}
		// holder[*http.Client] stores a pointer that must be constructed
		// elsewhere; only a by-value type argument yields a usable zero value.
		if _, isPtr := types.Unalias(tv.Type).(*types.Pointer); isPtr {
			continue
		}
		if what, ok := forbiddenTypeOf(tv.Type); ok {
			report(pass, allowLines, a.Pos(), "%s as a generic type argument outside the hardened egress package", what)
		}
	}
}

func identOf(e ast.Expr) *ast.Ident {
	id, _ := e.(*ast.Ident)
	return id
}

// forbiddenTypeOf reports whether t (after resolving aliases and stripping
// top-level pointers) is one of the types whose construction the analyzer
// forbids, or a container whose elements are: []http.Client,
// [2]http.Client, map[K]http.Client and chan http.Client all hand out
// usable zero-value clients. Pointer elements ([]*http.Client) do not, so
// only the top-level pointer is stripped.
func forbiddenTypeOf(t types.Type) (string, bool) {
	if t == nil {
		return "", false
	}
	for {
		t = types.Unalias(t)
		p, ok := t.(*types.Pointer)
		if !ok {
			break
		}
		t = p.Elem()
	}
	return forbiddenValueType(t)
}

func forbiddenValueType(t types.Type) (string, bool) {
	switch t := types.Unalias(t).(type) {
	case *types.Slice:
		return forbiddenValueType(t.Elem())
	case *types.Array:
		return forbiddenValueType(t.Elem())
	case *types.Map:
		return forbiddenValueType(t.Elem())
	case *types.Chan:
		return forbiddenValueType(t.Elem())
	case *types.Named:
		if t.Obj().Pkg() == nil {
			return "", false
		}
		what, ok := forbiddenTypes[t.Obj().Pkg().Path()][t.Obj().Name()]
		return what, ok
	}
	return "", false
}

func report(pass *analysis.Pass, allowLines map[int]string, pos token.Pos, format string, args ...any) {
	reason, covered := allowLines[pass.Fset.Position(pos).Line]
	if covered && reason != "" {
		return
	}
	if covered {
		pass.Reportf(pos, "%s directive needs a reason", Directive)
	}
	pass.Reportf(pos, format+" (see ADR 061; exempt with "+Directive+" <reason>)", args...)
}
