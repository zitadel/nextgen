package erroranalysis

import (
	"go/ast"
	"go/token"
	"go/types"
	"strconv"
	"strings"
)

// funcErrors returns the domain error constructors fn can return, analyzed
// under the given call-site bindings.
func (a *analyzer) funcErrors(fn *types.Func, b bindings, depth int) codeSet {
	if fn == nil || depth > maxDepth {
		return nil
	}
	fn = fn.Origin()

	if code, ok := a.errorConstructor(fn); ok {
		return codeSet{code: struct{}{}}
	}

	info := a.funcs[fn]
	if info == nil {
		// No body in the analyzed module: standard library, generated code, or
		// an interface method that dispatch failed to resolve. Opaque.
		return nil
	}

	key := fn.FullName() + "#" + b.key()
	if cached, ok := a.cache[key]; ok {
		return cached
	}
	if a.active[key] {
		// Recursive call: contribute nothing this time round. The caller's
		// fixpoint picks up whatever the base case produces.
		return nil
	}
	a.active[key] = true
	defer delete(a.active, key)

	f := newFrame(a, info, depth)
	for v, bd := range b {
		if len(bd.types) > 0 {
			f.env[v] = bd.types
		}
		if len(bd.codes) > 0 {
			f.varSet(v).union(bd.codes)
		}
	}

	sig, _ := fn.Type().(*types.Signature)
	for range maxIterations {
		if !f.walkStmts(info.decl.Body.List, sig, f.out) {
			break
		}
	}

	a.cache[key] = f.out
	return f.out
}

// errorConstructor reports whether fn is a domain ErrXxx constructor and, if
// so, the reference the generator indexes it by.
func (a *analyzer) errorConstructor(fn *types.Func) (string, bool) {
	if fn.Pkg() == nil || fn.Pkg().Path() != a.cfg.DomainPkgPath {
		return "", false
	}
	sig, _ := fn.Type().(*types.Signature)
	if sig == nil || sig.Recv() != nil {
		return "", false
	}
	if len(fn.Name()) < 4 || fn.Name()[:3] != "Err" {
		return "", false
	}
	if sig.Results().Len() == 0 || !implementsError(sig.Results().At(0).Type()) {
		return "", false
	}
	return "domain." + fn.Name(), true
}

// isErrorBuilder reports whether fn is one of the domain.Error fluent methods
// (WithMessage, WithParent, ...) — those pass their receiver's code through.
func (a *analyzer) isErrorBuilder(fn *types.Func) bool {
	sig, _ := fn.Type().(*types.Signature)
	if sig == nil || sig.Recv() == nil {
		return false
	}
	named, ok := deref(sig.Recv().Type()).(*types.Named)
	if !ok || named.Obj().Pkg() == nil {
		return false
	}
	return named.Obj().Pkg().Path() == a.cfg.DomainPkgPath && named.Obj().Name() == "Error"
}

// ---- Frame ------------------------------------------------------------------

// frame is the intra-procedural state for one function body: which concrete
// types each interface-typed variable may hold, which error codes each
// error-typed variable may carry, and what reaches a return.
type frame struct {
	a     *analyzer
	info  *funcInfo
	depth int

	env  map[*types.Var][]types.Type
	vars map[*types.Var]codeSet
	out  codeSet
}

func newFrame(a *analyzer, info *funcInfo, depth int) *frame {
	return &frame{
		a:     a,
		info:  info,
		depth: depth,
		env:   map[*types.Var][]types.Type{},
		vars:  map[*types.Var]codeSet{},
		out:   codeSet{},
	}
}

// nested shares env and vars with its parent so a closure sees the variables it
// captures, but collects its own returns.
func (f *frame) nested() *frame {
	return &frame{
		a:     f.a,
		info:  f.info,
		depth: f.depth + 1,
		env:   f.env,
		vars:  f.vars,
		out:   codeSet{},
	}
}

func (f *frame) info_() *types.Info { return f.info.pkg.TypesInfo }

func (f *frame) varSet(v *types.Var) codeSet {
	if f.vars[v] == nil {
		f.vars[v] = codeSet{}
	}
	return f.vars[v]
}

func (f *frame) object(e ast.Expr) *types.Var {
	ident, ok := unparen(e).(*ast.Ident)
	if !ok {
		return nil
	}
	obj := f.info_().Uses[ident]
	if obj == nil {
		obj = f.info_().Defs[ident]
	}
	v, _ := obj.(*types.Var)
	return v
}

// ---- Statements -------------------------------------------------------------

func (f *frame) walkStmts(list []ast.Stmt, sig *types.Signature, out codeSet) bool {
	changed := false
	for _, stmt := range list {
		if f.walkStmt(stmt, sig, out) {
			changed = true
		}
	}
	return changed
}

func (f *frame) walkStmt(stmt ast.Stmt, sig *types.Signature, out codeSet) bool {
	changed := false
	mark := func(c bool) {
		if c {
			changed = true
		}
	}

	switch s := stmt.(type) {
	case nil:
		return false

	case *ast.AssignStmt:
		mark(f.assign(s))

	case *ast.ReturnStmt:
		mark(f.ret(s, sig, out))

	case *ast.ExprStmt:
		// Not assigned anywhere, so it cannot reach a return — but a func
		// literal argument still needs analyzing for its own returns to be
		// attributed to whatever the call does with them.
		if call, ok := unparen(s.X).(*ast.CallExpr); ok {
			f.callErrors(call)
		}

	case *ast.DeclStmt:
		// var err error = ... — rare in this codebase; handled if it appears.
		if gen, ok := s.Decl.(*ast.GenDecl); ok {
			for _, spec := range gen.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for i, name := range vs.Names {
					if i < len(vs.Values) {
						mark(f.bind(name, vs.Values[i]))
					}
				}
			}
		}

	case *ast.BlockStmt:
		mark(f.walkStmts(s.List, sig, out))

	case *ast.IfStmt:
		mark(f.walkStmt(s.Init, sig, out))
		mark(f.walkStmt(s.Body, sig, out))
		mark(f.walkStmt(s.Else, sig, out))

	case *ast.ForStmt:
		mark(f.walkStmt(s.Init, sig, out))
		mark(f.walkStmt(s.Post, sig, out))
		mark(f.walkStmt(s.Body, sig, out))

	case *ast.RangeStmt:
		mark(f.rangeBind(s))
		mark(f.walkStmt(s.Body, sig, out))

	case *ast.SwitchStmt:
		mark(f.walkStmt(s.Init, sig, out))
		mark(f.walkStmt(s.Body, sig, out))

	case *ast.TypeSwitchStmt:
		mark(f.walkStmt(s.Init, sig, out))
		mark(f.walkStmt(s.Assign, sig, out))
		mark(f.walkStmt(s.Body, sig, out))

	case *ast.SelectStmt:
		mark(f.walkStmt(s.Body, sig, out))

	case *ast.CaseClause:
		mark(f.walkStmts(s.Body, sig, out))

	case *ast.CommClause:
		mark(f.walkStmt(s.Comm, sig, out))
		mark(f.walkStmts(s.Body, sig, out))

	case *ast.LabeledStmt:
		mark(f.walkStmt(s.Stmt, sig, out))

	case *ast.DeferStmt:
		f.callErrors(s.Call)

	case *ast.GoStmt:
		f.callErrors(s.Call)
	}

	return changed
}

// assign propagates both concrete types and error codes across an assignment.
func (f *frame) assign(s *ast.AssignStmt) bool {
	changed := false

	// errors.AsType[T](err) / errors.As(err, &t) hand the underlying error to
	// their target. Without this the transaction-unwrap idiom
	//   if de, ok := errors.AsType[domain.Error](err); ok { return de }
	// would drop every error raised inside the transaction.
	if len(s.Rhs) == 1 {
		if call, ok := unparen(s.Rhs[0]).(*ast.CallExpr); ok {
			if src, ok := f.errorUnwrapSource(call); ok && len(s.Lhs) > 0 {
				if v := f.object(s.Lhs[0]); v != nil {
					changed = f.varSet(v).union(f.evalErr(src)) || changed
				}
				return changed
			}
		}
	}

	if len(s.Rhs) == 1 && len(s.Lhs) > 1 {
		// x, err := f() — spread the call's error set over error-typed results.
		call, ok := unparen(s.Rhs[0]).(*ast.CallExpr)
		if !ok {
			return changed
		}
		codes := f.callErrors(call)
		for i, lhs := range s.Lhs {
			if !f.resultImplementsError(call, i) {
				changed = f.bind(lhs, nil) || changed
				continue
			}
			if v := f.object(lhs); v != nil {
				changed = f.varSet(v).union(codes) || changed
			}
		}
		return changed
	}

	for i, lhs := range s.Lhs {
		if i < len(s.Rhs) {
			changed = f.bind(lhs, s.Rhs[i]) || changed
		}
	}
	return changed
}

// bind records what rhs tells us about lhs: its error codes, and — when lhs is
// interface-typed but rhs is not — the concrete type it now holds.
func (f *frame) bind(lhs ast.Expr, rhs ast.Expr) bool {
	v := f.object(lhs)
	if v == nil || rhs == nil {
		return false
	}

	changed := false
	if implementsError(f.info_().TypeOf(lhs)) {
		changed = f.varSet(v).union(f.evalErr(rhs)) || changed
	}

	if isInterface(v.Type()) {
		for _, t := range f.concreteTypesOf(rhs) {
			if !containsType(f.env[v], t) {
				f.env[v] = append(f.env[v], t)
				changed = true
			}
		}
	}
	return changed
}

// rangeBind carries a binding from the ranged-over slice to the loop variable,
// so a variadic []UserAction bound to [*CreateUserAction] still resolves inside
// "for _, action := range actions".
func (f *frame) rangeBind(s *ast.RangeStmt) bool {
	if s.Value == nil {
		return false
	}
	src := f.object(s.X)
	dst := f.object(s.Value)
	if src == nil || dst == nil {
		return false
	}

	changed := false
	for _, t := range f.env[src] {
		if !containsType(f.env[dst], t) {
			f.env[dst] = append(f.env[dst], t)
			changed = true
		}
	}
	if implementsError(f.info_().TypeOf(s.Value)) {
		changed = f.varSet(dst).union(f.vars[src]) || changed
	}
	return changed
}

// ret adds whatever reaches an error-typed result position.
func (f *frame) ret(s *ast.ReturnStmt, sig *types.Signature, out codeSet) bool {
	if sig == nil {
		return false
	}
	results := sig.Results()

	// Naked return: the named error result carries the value.
	if len(s.Results) == 0 {
		changed := false
		for i := range results.Len() {
			v := results.At(i)
			if v.Name() != "" && implementsError(v.Type()) {
				changed = out.union(f.vars[v]) || changed
			}
		}
		return changed
	}

	// return f() where f is multi-valued.
	if len(s.Results) == 1 && results.Len() > 1 {
		if call, ok := unparen(s.Results[0]).(*ast.CallExpr); ok {
			return out.union(f.callErrors(call))
		}
	}

	changed := false
	for i, expr := range s.Results {
		if i >= results.Len() || !implementsError(results.At(i).Type()) {
			continue
		}
		changed = out.union(f.evalErr(expr)) || changed
	}
	return changed
}

// ---- Expressions ------------------------------------------------------------

// evalErr returns the error codes the expression may evaluate to.
func (f *frame) evalErr(expr ast.Expr) codeSet {
	switch e := unparen(expr).(type) {
	case nil:
		return nil

	case *ast.Ident:
		if e.Name == "nil" {
			return nil
		}
		if v := f.object(e); v != nil {
			return f.vars[v]
		}

	case *ast.CallExpr:
		return f.callErrors(e)

	case *ast.TypeAssertExpr:
		return f.evalErr(e.X)

	case *ast.SelectorExpr:
		// A field or package-level var holding an error; opaque, but a local
		// captured by name still resolves through Uses.
		if v := f.object(e.Sel); v != nil {
			return f.vars[v]
		}
	}
	return nil
}

// callErrors returns the error codes a call expression can produce.
func (f *frame) callErrors(call *ast.CallExpr) codeSet {
	codes := codeSet{}

	// A func literal passed as an argument is invoked by the callee, so its
	// returns belong to this call. This is what makes the errors raised inside
	// a Transaction(ctx, func(...) error {...}) callback visible.
	for _, arg := range call.Args {
		if lit, ok := unparen(arg).(*ast.FuncLit); ok {
			codes.union(f.funcLitErrors(lit))
		}
	}

	fn, recv := f.callee(call)
	if fn == nil {
		return codes
	}

	if code, ok := f.a.errorConstructor(fn); ok {
		codes.add(code)
		return codes
	}

	// A wrapped error still reaches the client with its own code: the API
	// boundary uses errors.As, which unwraps. So fmt.Errorf("%w: ...", ErrX())
	// returns ErrX as far as the spec is concerned.
	if wrapped, ok := f.wrappedErrors(call, fn); ok {
		for _, arg := range wrapped {
			codes.union(f.evalErr(arg))
		}
		return codes
	}

	// domain.ErrX(...).WithMessage(...) — the code comes from the receiver.
	if f.a.isErrorBuilder(fn) && recv != nil {
		codes.union(f.evalErr(recv))
		return codes
	}

	sig, _ := fn.Type().(*types.Signature)

	// Interface dispatch: resolve to the concrete types the receiver may hold.
	if sig != nil && sig.Recv() != nil && isInterface(sig.Recv().Type()) {
		for _, impl := range f.receiverTypes(recv, sig.Recv().Type()) {
			target := lookupMethod(impl, fn)
			if target == nil {
				continue
			}
			codes.union(f.a.funcErrors(target, f.calleeBindings(target, call), f.depth+1))
		}
		return codes
	}

	codes.union(f.a.funcErrors(fn, f.calleeBindings(fn, call), f.depth+1))
	return codes
}

// callee resolves the function a call targets, plus the receiver expression for
// method calls.
func (f *frame) callee(call *ast.CallExpr) (*types.Func, ast.Expr) {
	fun := unparen(call.Fun)
	// Strip explicit generic instantiation: f[T](...).
	for {
		switch e := fun.(type) {
		case *ast.IndexExpr:
			fun = unparen(e.X)
			continue
		case *ast.IndexListExpr:
			fun = unparen(e.X)
			continue
		}
		break
	}

	switch e := fun.(type) {
	case *ast.Ident:
		fn, _ := f.info_().Uses[e].(*types.Func)
		return fn, nil
	case *ast.SelectorExpr:
		if sel := f.info_().Selections[e]; sel != nil {
			fn, _ := sel.Obj().(*types.Func)
			return fn, e.X
		}
		// Package-qualified call: domain.ErrX(...).
		fn, _ := f.info_().Uses[e.Sel].(*types.Func)
		return fn, nil
	}
	return nil, nil
}

// receiverTypes narrows an interface receiver to the concrete types it may
// hold: the call-site binding when there is one, otherwise every module-local
// implementation.
func (f *frame) receiverTypes(recv ast.Expr, ifaceType types.Type) []types.Type {
	if recv != nil {
		if concrete := f.concreteTypesOf(recv); len(concrete) > 0 {
			return concrete
		}
	}
	iface, _ := ifaceType.Underlying().(*types.Interface)
	return f.a.implementations(iface)
}

// concreteTypesOf reports the non-interface types an expression may hold,
// either from its static type or from a call-site binding.
func (f *frame) concreteTypesOf(expr ast.Expr) []types.Type {
	if v := f.object(expr); v != nil && len(f.env[v]) > 0 {
		return f.env[v]
	}
	t := f.info_().TypeOf(expr)
	if t == nil || isInterface(t) {
		return nil
	}
	if _, ok := deref(t).(*types.Named); !ok {
		return nil
	}
	return []types.Type{t}
}

// calleeBindings tells the callee what this call site knows about its
// interface-typed and error-typed parameters.
func (f *frame) calleeBindings(fn *types.Func, call *ast.CallExpr) bindings {
	sig, _ := fn.Origin().Type().(*types.Signature)
	if sig == nil || sig.Params().Len() == 0 {
		return nil
	}

	// A method call's AST args exclude the receiver.
	args := call.Args
	out := bindings{}

	for i := range sig.Params().Len() {
		param := sig.Params().At(i)

		var group []ast.Expr
		if sig.Variadic() && i == sig.Params().Len()-1 {
			if call.Ellipsis.IsValid() {
				continue // f(xs...) — element types unknown without more work.
			}
			if i < len(args) {
				group = args[i:]
			}
		} else if i < len(args) {
			group = args[i : i+1]
		}

		elem := param.Type()
		if sig.Variadic() && i == sig.Params().Len()-1 {
			if slice, ok := elem.Underlying().(*types.Slice); ok {
				elem = slice.Elem()
			}
		}

		for _, arg := range group {
			if isInterface(elem) {
				for _, t := range f.concreteTypesOf(arg) {
					bd := out.get(param)
					if !containsType(bd.types, t) {
						bd.types = append(bd.types, t)
					}
				}
			}
			if implementsError(elem) {
				if codes := f.evalErr(arg); len(codes) > 0 {
					bd := out.get(param)
					if bd.codes == nil {
						bd.codes = codeSet{}
					}
					bd.codes.union(codes)
				}
			}
		}
	}

	for v, bd := range out {
		if len(bd.types) == 0 && len(bd.codes) == 0 {
			delete(out, v)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func (f *frame) funcLitErrors(lit *ast.FuncLit) codeSet {
	sig, _ := f.info_().TypeOf(lit).(*types.Signature)
	if sig == nil || f.depth > maxDepth {
		return nil
	}
	sub := f.nested()
	for range maxIterations {
		if !sub.walkStmts(lit.Body.List, sig, sub.out) {
			break
		}
	}
	return sub.out
}

// wrappedErrors recognizes the wrapping constructors and returns the arguments
// whose error chains survive into the result.
//
// fmt.Errorf only wraps when its format has a %w verb; without one the cause is
// flattened to text and its code is gone. A non-literal format is treated as
// wrapping, since guessing the other way would silently drop a real code.
func (f *frame) wrappedErrors(call *ast.CallExpr, fn *types.Func) ([]ast.Expr, bool) {
	if fn.Pkg() == nil {
		return nil, false
	}

	switch {
	case fn.Pkg().Path() == "fmt" && fn.Name() == "Errorf":
		if len(call.Args) < 2 {
			return nil, false
		}
		if format, ok := stringLiteral(call.Args[0]); ok && !strings.Contains(format, "%w") {
			return nil, false
		}
		return call.Args[1:], true

	case fn.Pkg().Path() == "errors" && fn.Name() == "Join":
		return call.Args, true
	}
	return nil, false
}

func stringLiteral(e ast.Expr) (string, bool) {
	lit, ok := unparen(e).(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", false
	}
	value, err := strconv.Unquote(lit.Value)
	if err != nil {
		return "", false
	}
	return value, true
}

// errorUnwrapSource recognizes errors.AsType[T](err) and errors.As(err, &t) and
// returns the error expression being unwrapped.
func (f *frame) errorUnwrapSource(call *ast.CallExpr) (ast.Expr, bool) {
	fn, _ := f.callee(call)
	if fn == nil || fn.Pkg() == nil || fn.Pkg().Path() != "errors" {
		return nil, false
	}
	switch fn.Name() {
	case "AsType", "As", "Unwrap":
		if len(call.Args) > 0 {
			return call.Args[0], true
		}
	}
	return nil, false
}

// resultImplementsError reports whether the i-th result of a call is an error.
func (f *frame) resultImplementsError(call *ast.CallExpr, i int) bool {
	t := f.info_().TypeOf(call)
	if tuple, ok := t.(*types.Tuple); ok {
		if i >= tuple.Len() {
			return false
		}
		return implementsError(tuple.At(i).Type())
	}
	return i == 0 && implementsError(t)
}

// ---- Type helpers -----------------------------------------------------------

var errorType = types.Universe.Lookup("error").Type().Underlying().(*types.Interface)

func implementsError(t types.Type) bool {
	if t == nil {
		return false
	}
	if _, ok := t.(*types.Tuple); ok {
		return false
	}
	return types.Implements(t, errorType) || types.Implements(types.NewPointer(t), errorType)
}

func isInterface(t types.Type) bool {
	if t == nil {
		return false
	}
	_, ok := t.Underlying().(*types.Interface)
	return ok
}

func deref(t types.Type) types.Type {
	if ptr, ok := t.(*types.Pointer); ok {
		return ptr.Elem()
	}
	return t
}

func unparen(e ast.Expr) ast.Expr {
	for {
		p, ok := e.(*ast.ParenExpr)
		if !ok {
			return e
		}
		e = p.X
	}
}

func containsType(list []types.Type, t types.Type) bool {
	for _, existing := range list {
		if types.Identical(existing, t) {
			return true
		}
	}
	return false
}
