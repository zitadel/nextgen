package erroranalysis

import (
	"go/ast"
	"go/constant"
	"go/token"
	"go/types"
	"strconv"
	"strings"

	"golang.org/x/tools/go/packages"
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
		a.cycleHits[key] = true
		return nil
	}
	a.active[key] = true
	defer delete(a.active, key)

	// Collect which active functions this walk bottomed out on, so the result
	// is only cached when it is not under-approximated. Direct recursion is
	// exact — f's set is the least fixpoint of its own non-recursive
	// contributions, which is what contributing nil computes — but mutual
	// recursion is not: while A is active, B's call to A contributes nothing,
	// so B's result is missing A's own errors. Caching that truncated set would
	// hand it to every later caller of B, permanently.
	outerHits := a.cycleHits
	a.cycleHits = map[string]bool{}

	f := newFrame(a, info, depth)
	for v, bd := range b {
		if len(bd.types) > 0 {
			f.env[v] = bd.types
		}
		if len(bd.codes) > 0 {
			f.varSet(v).union(bd.codes)
		}
		if len(bd.fields) > 0 {
			f.fieldEnv[v] = bd.fields
		}
		if bd.konst != nil {
			f.constEnv[v] = bd.konst
		}
	}

	sig, _ := fn.Type().(*types.Signature)
	for range maxIterations {
		if !f.walkStmts(info.decl.Body.List, sig, f.out) {
			break
		}
	}

	hits := a.cycleHits
	delete(hits, key)
	if len(hits) == 0 {
		a.cache[key] = f.out
	}
	// A cycle this frame did not close still constrains its callers, so the
	// hits travel up until the frame that opened the cycle absorbs them.
	for hit := range hits {
		outerHits[hit] = true
	}
	a.cycleHits = outerHits

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
	// fieldEnv holds, per struct-typed variable, the codes reachable through
	// each of its func-typed fields, as resolved by the call site.
	fieldEnv map[*types.Var]map[string]codeSet
	// constEnv holds the constant a parameter was called with, used to decide
	// comparisons against it without walking the branch that cannot run.
	constEnv map[*types.Var]constant.Value
	out      codeSet
}

func newFrame(a *analyzer, info *funcInfo, depth int) *frame {
	return &frame{
		a:        a,
		info:     info,
		depth:    depth,
		env:      map[*types.Var][]types.Type{},
		vars:     map[*types.Var]codeSet{},
		fieldEnv: map[*types.Var]map[string]codeSet{},
		constEnv: map[*types.Var]constant.Value{},
		out:      codeSet{},
	}
}

// nested shares env and vars with its parent so a closure sees the variables it
// captures, but collects its own returns.
func (f *frame) nested() *frame {
	return &frame{
		a:        f.a,
		info:     f.info,
		depth:    f.depth + 1,
		env:      f.env,
		vars:     f.vars,
		fieldEnv: f.fieldEnv,
		constEnv: f.constEnv,
		out:      codeSet{},
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
		mark(f.bindAsTargets(s.X))

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
		mark(f.bindAsTargets(s.Cond))
		// A guard that branches on a mode parameter the call site pinned to a
		// constant only reaches one side. Walking both would credit this
		// operation with the errors of every other caller's mode.
		switch f.condValue(s.Cond) {
		case condTrue:
			mark(f.walkStmt(s.Body, sig, out))
		case condFalse:
			mark(f.walkStmt(s.Else, sig, out))
		default:
			mark(f.walkStmt(s.Body, sig, out))
			mark(f.walkStmt(s.Else, sig, out))
		}

	case *ast.ForStmt:
		mark(f.walkStmt(s.Init, sig, out))
		mark(f.walkStmt(s.Post, sig, out))
		mark(f.walkStmt(s.Body, sig, out))

	case *ast.RangeStmt:
		mark(f.rangeBind(s))
		mark(f.walkStmt(s.Body, sig, out))

	case *ast.SwitchStmt:
		mark(f.walkStmt(s.Init, sig, out))
		mark(f.bindAsTargets(s.Tag))
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

	// ok := errors.As(err, &de) binds through the argument, not the result, so
	// it is handled before anything looks at the left-hand side.
	for _, rhs := range s.Rhs {
		changed = f.bindAsTargets(rhs) || changed
	}

	// errors.AsType[T](err) hands the underlying error to its target. Without
	// this the transaction-unwrap idiom
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
		// Not a resolvable function: it may still be a call through a func-typed
		// struct field the call site bound for us.
		codes.union(f.fieldCallCodes(call))
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

	b := f.calleeBindings(fn, call)
	// Method calls like res.miss(op) put the struct in the receiver, not in
	// call.Args — bind its func-typed fields the same way as struct parameters
	// so the callee can resolve res.readMiss() / res.writeMiss().
	if sig != nil && sig.Recv() != nil && recv != nil {
		if _, isStruct := deref(sig.Recv().Type()).Underlying().(*types.Struct); isStruct {
			if fields := f.funcFieldCodes(recv); len(fields) > 0 {
				if b == nil {
					b = bindings{}
				}
				b.get(sig.Recv()).fields = fields
			}
		}
	}
	codes.union(f.a.funcErrors(fn, b, f.depth+1))
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
			if _, isStruct := deref(elem).Underlying().(*types.Struct); isStruct {
				if fields := f.funcFieldCodes(arg); len(fields) > 0 {
					out.get(param).fields = fields
				}
			}
			if konst, ok := f.constValue(arg); ok && len(group) == 1 {
				out.get(param).konst = konst
			}
		}
	}

	for v, bd := range out {
		if len(bd.types) == 0 && len(bd.codes) == 0 && len(bd.fields) == 0 && bd.konst == nil {
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

// condResult is how much a condition could be decided before walking it.
type condResult int

const (
	condUnknown condResult = iota
	condTrue
	condFalse
)

// condValue decides an == or != comparison when one side is a parameter the
// call site bound to a constant and the other is a constant expression.
// Anything else stays unknown, and both branches are walked as before.
func (f *frame) condValue(cond ast.Expr) condResult {
	bin, ok := unparen(cond).(*ast.BinaryExpr)
	if !ok || (bin.Op != token.EQL && bin.Op != token.NEQ) {
		return condUnknown
	}

	left, okL := f.constValue(bin.X)
	right, okR := f.constValue(bin.Y)
	if !okL || !okR {
		return condUnknown
	}

	equal := constant.Compare(left, token.EQL, right)
	if bin.Op == token.NEQ {
		equal = !equal
	}
	if equal {
		return condTrue
	}
	return condFalse
}

// constValue reads an expression's constant value: either the literal constant
// the type checker folded, or the one bound to a parameter at the call site.
func (f *frame) constValue(e ast.Expr) (constant.Value, bool) {
	if v := f.object(e); v != nil {
		if bound, ok := f.constEnv[v]; ok && bound != nil {
			return bound, true
		}
	}
	if tv, ok := f.info_().Types[unparen(e)]; ok && tv.Value != nil {
		return tv.Value, true
	}
	return nil, false
}

// fieldCallCodes resolves a call made through a func-typed struct field
// (res.readMiss()) using the binding its call site supplied. Without a binding
// there is nothing to resolve: the field's value is chosen by whoever built the
// struct, not by the function being analyzed.
func (f *frame) fieldCallCodes(call *ast.CallExpr) codeSet {
	sel, ok := unparen(call.Fun).(*ast.SelectorExpr)
	if !ok {
		return nil
	}
	v := f.object(sel.X)
	if v == nil {
		return nil
	}
	return f.fieldEnv[v][sel.Sel.Name]
}

// funcFieldCodes resolves arg to a struct composite literal and returns, per
// func-typed field, the codes calling that field can raise. Both forms the
// access rows use are handled: a bare constructor reference
// (readMiss: domain.ErrUserNotFound) and a literal that decorates one
// (writeMiss: func() domain.Error { return domain.ErrUserInvalid()... }).
//
// When arg is a parameter/local already bound with field codes (for example
// Handler.requireProjectAccess forwarding its `res` into the package-level
// helper), pass that binding through — compositeLit only resolves package-level
// vars and inline literals.
func (f *frame) funcFieldCodes(arg ast.Expr) map[string]codeSet {
	if id, ok := unparen(arg).(*ast.Ident); ok {
		if v := f.object(id); v != nil {
			if fields := f.fieldEnv[v]; len(fields) > 0 {
				return fields
			}
		}
	}

	pkg, lit := f.compositeLit(arg)
	if lit == nil {
		return nil
	}

	out := map[string]codeSet{}
	for _, elt := range lit.Elts {
		kv, ok := elt.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		key, ok := kv.Key.(*ast.Ident)
		if !ok {
			continue
		}
		if codes := f.a.funcValueCodes(pkg, kv.Value, f.depth+1); len(codes) > 0 {
			out[key.Name] = codes
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// compositeLit resolves an expression to the struct literal behind it, either
// written inline or held by a package-level variable, along with the package
// whose type info types it.
func (f *frame) compositeLit(arg ast.Expr) (*packages.Package, *ast.CompositeLit) {
	switch e := unparen(arg).(type) {
	case *ast.CompositeLit:
		return f.info.pkg, e
	case *ast.Ident:
		v, _ := f.info_().Uses[e].(*types.Var)
		if v == nil {
			return nil, nil
		}
		init, ok := f.a.vars[v]
		if !ok {
			return nil, nil
		}
		lit, _ := unparen(init.expr).(*ast.CompositeLit)
		return init.pkg, lit
	}
	return nil, nil
}

// funcValueCodes evaluates a func-valued expression — a reference to a function
// or a literal — to the error codes calling it can raise.
func (a *analyzer) funcValueCodes(pkg *packages.Package, expr ast.Expr, depth int) codeSet {
	if pkg == nil || depth > maxDepth {
		return nil
	}

	if lit, ok := unparen(expr).(*ast.FuncLit); ok {
		f := &frame{
			a:        a,
			info:     &funcInfo{pkg: pkg},
			depth:    depth,
			env:      map[*types.Var][]types.Type{},
			vars:     map[*types.Var]codeSet{},
			fieldEnv: map[*types.Var]map[string]codeSet{},
			constEnv: map[*types.Var]constant.Value{},
			out:      codeSet{},
		}
		return f.funcLitErrors(lit)
	}

	var fn *types.Func
	switch e := unparen(expr).(type) {
	case *ast.Ident:
		fn, _ = pkg.TypesInfo.Uses[e].(*types.Func)
	case *ast.SelectorExpr:
		fn, _ = pkg.TypesInfo.Uses[e.Sel].(*types.Func)
	}
	if fn == nil {
		return nil
	}
	return a.funcErrors(fn, nil, depth)
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

// errorUnwrapSource recognizes the unwrap helpers whose target is the call's
// first result — errors.AsType[T](err) and errors.Unwrap(err) — and returns the
// error expression being unwrapped. errors.As is deliberately absent: its first
// result is a bool and its target is the second argument, so it is handled by
// [frame.bindAsTarget] instead.
func (f *frame) errorUnwrapSource(call *ast.CallExpr) (ast.Expr, bool) {
	fn, _ := f.callee(call)
	if fn == nil || fn.Pkg() == nil || fn.Pkg().Path() != "errors" {
		return nil, false
	}
	switch fn.Name() {
	case "AsType", "Unwrap":
		if len(call.Args) > 0 {
			return call.Args[0], true
		}
	}
	return nil, false
}

// bindAsTarget propagates the inspected error's codes into the pointer target
// of errors.As(err, &target), and reports whether that changed anything.
//
// The codebase idiom is errors.AsType, whose target is the call's first result,
// but errors.As writes through its second argument instead — so neither the
// assignment's LHS (a bool) nor the call's result carries the error, and the
// call can appear where no assignment does at all:
//
//	if errors.As(err, &de) { return de }
//
// Missing that would silently drop de's codes from the operation's spec, which
// is exactly the client decode failure this analysis exists to prevent.
func (f *frame) bindAsTarget(call *ast.CallExpr) bool {
	fn, _ := f.callee(call)
	if fn == nil || fn.Pkg() == nil || fn.Pkg().Path() != "errors" || fn.Name() != "As" {
		return false
	}
	if len(call.Args) < 2 {
		return false
	}
	unary, ok := unparen(call.Args[1]).(*ast.UnaryExpr)
	if !ok || unary.Op != token.AND {
		return false
	}
	v := f.object(unary.X)
	if v == nil {
		return false
	}
	return f.varSet(v).union(f.evalErr(call.Args[0]))
}

// bindAsTargets binds every errors.As target inside expr. Expressions that are
// not assignment right-hand sides — an if condition, a switch tag — are not
// otherwise walked for calls, and errors.As binds through an argument rather
// than through a result, so it has to be looked for explicitly.
func (f *frame) bindAsTargets(expr ast.Expr) bool {
	if expr == nil {
		return false
	}
	changed := false
	ast.Inspect(expr, func(n ast.Node) bool {
		if call, ok := n.(*ast.CallExpr); ok && f.bindAsTarget(call) {
			changed = true
		}
		return true
	})
	return changed
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
