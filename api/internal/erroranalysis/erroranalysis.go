// Package erroranalysis infers, from the Go source itself, which domain error
// constructors a service interface method can return.
//
// The OpenAPI error-response generator used to read a hand-maintained
// "errors: domain.ErrX, domain.ErrY" line from each interface method's doc
// comment. That list rots: it is written once and never re-checked against the
// code. This package derives the same list by following the error value
// through the call graph, so the spec tracks the implementation.
//
// # How it works
//
// For every method on an interface named *Service in the service package, the
// analyzer finds the concrete implementation and walks its body, tracking
// which domain error constructors can reach an error-typed return position:
//
//   - a returned domain.ErrX(...) call contributes domain.ErrX;
//   - a returned variable contributes whatever was assigned to it, so
//     err := s.foo(); ...; return err pulls in s.foo's error set;
//   - a returned call contributes that callee's error set, recursively;
//   - errors.AsType[domain.Error](err) propagates err's set to its target,
//     which is how the transaction-unwrap idiom keeps its inner errors.
//
// Errors only *inspected* (errors.Is(err, domain.ErrY())) never reach a return
// position, so they are correctly excluded — that is the whole reason this is
// a dataflow analysis and not a grep for "domain.Err".
//
// # Dynamic dispatch
//
// Calls through an interface are resolved to every concrete implementation
// loaded from the module, unioned. That is exact for the storage statements
// (all dialects raise the same domain errors) but too coarse for a fan-out
// like UserService.ApplyActions, which invokes Prepare/Apply on an
// interface-typed variadic parameter: unioned blindly, deleting a user would
// advertise the errors of creating one.
//
// So call sites bind concrete types to interface-typed parameters, and the
// callee is analyzed once per binding. ApplyActions analyzed with
// actions=[*CreateUserAction] resolves action.Prepare to
// (*CreateUserAction).Prepare and nothing else. Bindings flow through range
// loops and closures, which is what the transaction callback needs.
package erroranalysis

import (
	"fmt"
	"go/ast"
	"go/types"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

const (
	// maxIterations bounds the intra-procedural fixpoint. Error values in this
	// codebase flow forward, so one pass almost always suffices; the extra
	// rounds only matter for loops and closures that read a variable before
	// its assignment is visited.
	maxIterations = 4
	// maxDepth bounds call-graph recursion.
	maxDepth = 32
)

// Config selects what to load and which packages carry meaning.
type Config struct {
	// Dir is the directory to load packages from (the module root).
	Dir string
	// Patterns are the go/packages load patterns. Defaults to ./internal/...
	Patterns []string
	// ModulePrefix limits analysis to packages inside the module; calls into
	// anything else are treated as opaque.
	ModulePrefix string
	// DomainPkgPath is the package holding the ErrXxx constructors.
	DomainPkgPath string
	// InterfaceSuffix selects the entry-point interfaces. Defaults to "Service".
	InterfaceSuffix string
	// EntryPkgPath is the package holding the entry-point interfaces.
	EntryPkgPath string
}

func (c *Config) withDefaults() {
	if len(c.Patterns) == 0 {
		c.Patterns = []string{"./internal/..."}
	}
	if c.ModulePrefix == "" {
		c.ModulePrefix = "github.com/zitadel/nextgen/"
	}
	if c.DomainPkgPath == "" {
		c.DomainPkgPath = "github.com/zitadel/nextgen/internal/domain"
	}
	if c.EntryPkgPath == "" {
		c.EntryPkgPath = "github.com/zitadel/nextgen/internal/service"
	}
	if c.InterfaceSuffix == "" {
		c.InterfaceSuffix = "Service"
	}
}

// Method is one analyzed interface method.
type Method struct {
	Interface string
	Name      string
	// Errors are the domain constructor references ("domain.ErrUserNotFound")
	// the method can return, sorted.
	Errors []string
	// Unimplemented is true when no concrete implementation was found, which
	// means Errors is empty for lack of evidence rather than by analysis.
	Unimplemented bool
}

// Key is the "Interface.Method" identifier the generator indexes by.
func (m Method) Key() string { return m.Interface + "." + m.Name }

// Analyze loads the module and infers the error set of every entry-point
// interface method.
func Analyze(cfg Config) (map[string]Method, error) {
	cfg.withDefaults()

	a, err := newAnalyzer(cfg)
	if err != nil {
		return nil, err
	}
	return a.run()
}

type funcInfo struct {
	pkg  *packages.Package
	decl *ast.FuncDecl
}

type analyzer struct {
	cfg Config

	pkgs  []*packages.Package
	funcs map[*types.Func]*funcInfo

	// concrete holds every non-generic named type (and its pointer) declared
	// in the module, used to resolve interface dispatch.
	concrete  []types.Type
	implCache map[*types.Interface][]types.Type

	cache  map[string]codeSet
	active map[string]bool
}

func newAnalyzer(cfg Config) (*analyzer, error) {
	loaded, err := packages.Load(&packages.Config{
		Dir: cfg.Dir,
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles |
			packages.NeedImports | packages.NeedDeps | packages.NeedTypes |
			packages.NeedSyntax | packages.NeedTypesInfo,
	}, cfg.Patterns...)
	if err != nil {
		return nil, fmt.Errorf("load packages: %w", err)
	}

	a := &analyzer{
		cfg:       cfg,
		funcs:     map[*types.Func]*funcInfo{},
		implCache: map[*types.Interface][]types.Type{},
		cache:     map[string]codeSet{},
		active:    map[string]bool{},
	}

	seen := map[string]bool{}
	packages.Visit(loaded, nil, func(p *packages.Package) {
		if seen[p.PkgPath] || !a.indexable(p) {
			return
		}
		seen[p.PkgPath] = true
		a.pkgs = append(a.pkgs, p)
	})

	if len(a.pkgs) == 0 {
		return nil, fmt.Errorf("no packages matched %v in %s", cfg.Patterns, cfg.Dir)
	}

	for _, p := range a.pkgs {
		a.indexFuncs(p)
		a.indexTypes(p)
	}
	return a, nil
}

// indexable keeps in-module, non-generated packages. Generated mocks implement
// the same interfaces as the real code but return nothing meaningful, so
// including them would only add noise to interface dispatch.
func (a *analyzer) indexable(p *packages.Package) bool {
	if p.Types == nil || p.TypesInfo == nil || len(p.Syntax) == 0 {
		return false
	}
	if !strings.HasPrefix(p.PkgPath, a.cfg.ModulePrefix) {
		return false
	}
	for _, seg := range strings.Split(p.PkgPath, "/") {
		if seg == "mock" || seg == "mocks" {
			return false
		}
	}
	return true
}

func (a *analyzer) indexFuncs(p *packages.Package) {
	for _, file := range p.Syntax {
		for _, decl := range file.Decls {
			fd, ok := decl.(*ast.FuncDecl)
			if !ok || fd.Body == nil {
				continue
			}
			fn, _ := p.TypesInfo.Defs[fd.Name].(*types.Func)
			if fn == nil {
				continue
			}
			a.funcs[fn.Origin()] = &funcInfo{pkg: p, decl: fd}
		}
	}
}

func (a *analyzer) indexTypes(p *packages.Package) {
	scope := p.Types.Scope()
	for _, name := range scope.Names() {
		tn, ok := scope.Lookup(name).(*types.TypeName)
		if !ok || tn.IsAlias() {
			continue
		}
		named, ok := tn.Type().(*types.Named)
		if !ok || named.TypeParams().Len() > 0 {
			continue
		}
		if _, isIface := named.Underlying().(*types.Interface); isIface {
			continue
		}
		a.concrete = append(a.concrete, named, types.NewPointer(named))
	}
}

func (a *analyzer) run() (map[string]Method, error) {
	out := map[string]Method{}

	for _, p := range a.pkgs {
		if p.PkgPath != a.cfg.EntryPkgPath {
			continue
		}
		scope := p.Types.Scope()
		for _, name := range scope.Names() {
			if !strings.HasSuffix(name, a.cfg.InterfaceSuffix) {
				continue
			}
			tn, ok := scope.Lookup(name).(*types.TypeName)
			if !ok {
				continue
			}
			named, ok := tn.Type().(*types.Named)
			if !ok {
				continue
			}
			iface, ok := named.Underlying().(*types.Interface)
			if !ok {
				continue
			}
			for _, m := range a.analyzeInterface(name, iface) {
				out[m.Key()] = m
			}
		}
	}
	return out, nil
}

func (a *analyzer) analyzeInterface(name string, iface *types.Interface) []Method {
	impls := a.implementations(iface)

	methods := make([]Method, 0, iface.NumMethods())
	for i := range iface.NumMethods() {
		ifaceMethod := iface.Method(i)

		codes := codeSet{}
		found := false
		for _, impl := range impls {
			fn := lookupMethod(impl, ifaceMethod)
			if fn == nil || a.funcs[fn.Origin()] == nil {
				continue
			}
			found = true
			codes.union(a.funcErrors(fn, nil, 0))
		}

		methods = append(methods, Method{
			Interface:     name,
			Name:          ifaceMethod.Name(),
			Errors:        codes.sorted(),
			Unimplemented: !found,
		})
	}
	return methods
}

// implementations returns every module-local concrete type satisfying iface.
func (a *analyzer) implementations(iface *types.Interface) []types.Type {
	if iface == nil || iface.Empty() {
		return nil
	}
	if cached, ok := a.implCache[iface]; ok {
		return cached
	}
	// Guard against re-entrancy while the set is being computed.
	a.implCache[iface] = nil

	var impls []types.Type
	for _, t := range a.concrete {
		if types.Implements(t, iface) {
			impls = append(impls, t)
		}
	}
	a.implCache[iface] = impls
	return impls
}

func lookupMethod(recv types.Type, want *types.Func) *types.Func {
	obj, _, _ := types.LookupFieldOrMethod(recv, true, want.Pkg(), want.Name())
	fn, _ := obj.(*types.Func)
	return fn
}

// ---- Bindings ---------------------------------------------------------------

// binding is what a call site knows about one parameter: the concrete types it
// may hold (for interface-typed parameters) and the error codes it may carry
// (for error-typed parameters, so pass-through helpers stay transparent).
type binding struct {
	types []types.Type
	codes codeSet
}

type bindings map[*types.Var]*binding

func (b bindings) get(v *types.Var) *binding {
	if b[v] == nil {
		b[v] = &binding{}
	}
	return b[v]
}

// key canonicalizes the bindings so the per-binding analysis can be cached.
func (b bindings) key() string {
	if len(b) == 0 {
		return ""
	}
	parts := make([]string, 0, len(b))
	for v, bd := range b {
		names := make([]string, 0, len(bd.types))
		for _, t := range bd.types {
			names = append(names, t.String())
		}
		sort.Strings(names)
		parts = append(parts, v.Name()+"="+strings.Join(names, "|")+"/"+strings.Join(bd.codes.sorted(), "|"))
	}
	sort.Strings(parts)
	return strings.Join(parts, ";")
}

// ---- Code sets --------------------------------------------------------------

type codeSet map[string]struct{}

func (s codeSet) add(code string) bool {
	if _, ok := s[code]; ok {
		return false
	}
	s[code] = struct{}{}
	return true
}

func (s codeSet) union(other codeSet) bool {
	changed := false
	for code := range other {
		if s.add(code) {
			changed = true
		}
	}
	return changed
}

func (s codeSet) clone() codeSet {
	out := make(codeSet, len(s))
	out.union(s)
	return out
}

func (s codeSet) sorted() []string {
	if len(s) == 0 {
		return nil
	}
	out := make([]string, 0, len(s))
	for code := range s {
		out = append(out, code)
	}
	sort.Strings(out)
	return out
}
