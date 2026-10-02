package service

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// TestServiceMethodsStartSpan keeps every exported method of a service struct
// traced: its body must open with
//
//	ctx, end := startSpan(ctx, "<Service>.<Method>")
//	defer end(&err)
//
// where <Service> is the exported type whose name matches the struct name
// ignoring case (the interface, e.g. UserService for userService), or the
// struct name capitalized when there is none.
func TestServiceMethodsStartSpan(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	var decls []*ast.FuncDecl
	typeNames := map[string]string{} // lower-case name -> exported type name
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, name, nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range f.Decls {
			switch d := d.(type) {
			case *ast.FuncDecl:
				decls = append(decls, d)
			case *ast.GenDecl:
				for _, s := range d.Specs {
					if ts, ok := s.(*ast.TypeSpec); ok && ts.Name.IsExported() {
						typeNames[strings.ToLower(ts.Name.Name)] = ts.Name.Name
					}
				}
			}
		}
	}

	var missing []string
	for _, d := range decls {
		if d.Recv == nil || !d.Name.IsExported() {
			continue
		}
		recv := d.Recv.List[0].Type
		if star, ok := recv.(*ast.StarExpr); ok {
			recv = star.X
		}
		ident, ok := recv.(*ast.Ident)
		if !ok || (!strings.HasSuffix(ident.Name, "Service") && ident.Name != "EventExportAdapter") {
			continue
		}
		service, ok := typeNames[strings.ToLower(ident.Name)]
		if !ok {
			service = strings.ToUpper(ident.Name[:1]) + ident.Name[1:]
		}
		want := service + "." + d.Name.Name
		if !startsSpan(d.Body, want) {
			missing = append(missing, fset.Position(d.Pos()).String()+": "+want)
		}
	}
	if len(missing) > 0 {
		t.Errorf("%d service methods do not start with startSpan and defer end(&err):\n%s", len(missing), strings.Join(missing, "\n"))
	}
}

func startsSpan(body *ast.BlockStmt, want string) bool {
	if body == nil || len(body.List) < 2 {
		return false
	}
	assign, ok := body.List[0].(*ast.AssignStmt)
	if !ok || len(assign.Rhs) != 1 {
		return false
	}
	call, ok := assign.Rhs[0].(*ast.CallExpr)
	if !ok || len(call.Args) != 2 {
		return false
	}
	if fn, ok := call.Fun.(*ast.Ident); !ok || fn.Name != "startSpan" {
		return false
	}
	lit, ok := call.Args[1].(*ast.BasicLit)
	if !ok {
		return false
	}
	if name, err := strconv.Unquote(lit.Value); err != nil || name != want {
		return false
	}
	deferred, ok := body.List[1].(*ast.DeferStmt)
	if !ok {
		return false
	}
	fn, ok := deferred.Call.Fun.(*ast.Ident)
	if !ok || fn.Name != "end" || len(deferred.Call.Args) != 1 {
		return false
	}
	// end dereferences its argument, so it must be the address of the error.
	arg, ok := deferred.Call.Args[0].(*ast.UnaryExpr)
	return ok && arg.Op == token.AND
}
