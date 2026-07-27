package database

import (
	"fmt"
	"strconv"
	"strings"

	legacydb "github.com/zitadel/nextgen/internal/storage/database"
)

// ErrNoChanges is returned when an Update is called with no assignments.
// It aliases the v1 sentinel so callers can use errors.Is with either import path.
var ErrNoChanges = legacydb.ErrNoChanges

// Assignment is one column assignment for a statements UPDATE SET clause.
type Assignment struct {
	Column string
	// Value binds as Column = $n when Expr is empty and Null is false.
	Value any
	// Null sets Column = NULL (Value ignored).
	Null bool
	// Expr is the SQL RHS when non-empty (e.g. "failed_attempts + 1").
	// Use "?" for bound args from ExprArgs; each "?" becomes the next $n placeholder.
	Expr     string
	ExprArgs []any
}

// BuildSetClause renders assignments as "col = $N, ..." starting at start (1-based).
// It does not include the SET keyword or updated_at.
func BuildSetClause(assignments []Assignment, start int) (clause string, args []any, next int, err error) {
	if len(assignments) == 0 {
		return "", nil, start, ErrNoChanges
	}
	if start < 1 {
		return "", nil, start, fmt.Errorf("placeholder start must be >= 1")
	}

	var b strings.Builder
	args = make([]any, 0, len(assignments))
	n := start
	for i, a := range assignments {
		if a.Column == "" {
			return "", nil, start, fmt.Errorf("assignment %d: empty column", i)
		}
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString(a.Column)
		b.WriteString(" = ")
		switch {
		case a.Expr != "":
			expr, exprArgs, nextIdx, exprErr := replaceExprPlaceholders(a.Expr, a.ExprArgs, n)
			if exprErr != nil {
				return "", nil, start, fmt.Errorf("assignment %d (%s): %w", i, a.Column, exprErr)
			}
			b.WriteString(expr)
			args = append(args, exprArgs...)
			n = nextIdx
		case a.Null:
			b.WriteString("NULL")
		default:
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
			args = append(args, a.Value)
			n++
		}
	}
	return b.String(), args, n, nil
}

func replaceExprPlaceholders(expr string, exprArgs []any, start int) (string, []any, int, error) {
	var b strings.Builder
	b.Grow(len(expr) + 8)
	args := make([]any, 0, len(exprArgs))
	argIdx := 0
	n := start
	for i := 0; i < len(expr); i++ {
		if expr[i] == '?' {
			if argIdx >= len(exprArgs) {
				return "", nil, start, fmt.Errorf("expr has more ? placeholders than ExprArgs")
			}
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
			args = append(args, exprArgs[argIdx])
			argIdx++
			n++
			continue
		}
		b.WriteByte(expr[i])
	}
	if argIdx != len(exprArgs) {
		return "", nil, start, fmt.Errorf("expr has fewer ? placeholders than ExprArgs")
	}
	return b.String(), args, n, nil
}
