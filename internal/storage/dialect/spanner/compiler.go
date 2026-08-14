package spanner

import (
	"context"
	"strconv"
	"strings"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/compare"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/dialect/pattern"
)

type statementCompiler struct {
	strings.Builder
	args []any
}

func (c *statementCompiler) Reset() {
	c.Builder.Reset()
	c.args = nil
}

func compileRead[F ~uint8, T any](c *statementCompiler, stmt string, opt *database.ListOptions[F], schema database.Schema[F, T]) error {
	return compileList[F, T](context.Background(), c, stmt, opt, schema, "", "")
}

// compileList builds a list SELECT with optional authz EXISTS injection before
// ORDER BY / LIMIT. tableName and resourceIDCol identify the outer resource row
// (e.g. "teams", "id"); empty skips authz.
func compileList[F ~uint8, T any](ctx context.Context, c *statementCompiler, stmt string, opt *database.ListOptions[F], schema database.Schema[F, T], tableName, resourceIDCol string) error {
	c.WriteString(stmt)

	filter := opt.Filter
	if len(opt.Pagination.Cursor) != 0 {
		cursor, err := pagination.CursorFromToken[F](opt.Pagination.Cursor)
		if err != nil {
			return database.ErrInvalidCursor()
		}
		if !cursor.MatchesOrderBy(opt.Pagination.OrderBy) {
			return database.ErrCursorOrderMismatch()
		}
		values, err := schema.CoerceCursorValues(cursor.Columns, cursor.Values)
		if err != nil {
			return database.ErrInvalidCursor().WithParent(err)
		}
		terms := compareTerms(cursor.Columns, values)
		if opt.Pagination.OrderBy.Direction == database.OrderAsc {
			filter = database.And(filter, database.CompareGreater(terms...))
		} else {
			filter = database.And(filter, database.CompareLess(terms...))
		}
	}
	hasWhere := false
	if filter != nil {
		c.WriteString(" WHERE ")
		compileFilter(c, filter, schema)
		hasWhere = true
	}
	if tableName != "" && resourceIDCol != "" {
		maybeWriteAuthzListPredicate(ctx, c, &hasWhere, tableName, resourceIDCol)
	}

	compileOrderBy(c, opt.Pagination.OrderBy, schema)
	compileLimit(c, opt.Pagination.Limit)

	return nil
}

func compareTerms[F ~uint8](columns []database.Column[F], values []any) []database.CompareTerm[F] {
	terms := make([]database.CompareTerm[F], len(columns))
	for i, column := range columns {
		terms[i] = database.Term(column, values[i])
	}
	return terms
}

func compileFilter[F ~uint8, T any](c *statementCompiler, filter database.Filter[F], schema database.Schema[F, T]) {
	if filter == nil {
		return
	}

	switch f := filter.(type) {
	case database.AndFilter[F]:
		compileAndFilter(c, f, schema)
	case database.OrFilter[F]:
		compileOrFilter(c, f, schema)
	case *database.CompareFilter[F]:
		compileCompareFilter(c, f, schema)
	case *database.StringFilter[F]:
		compileStringFilter(c, f, schema)
	case *database.ArrayContainsFilter[F]:
		compileArrayContainsFilter(c, f, schema)
	default:
		panic("unknown filter type")
	}
}

func compileAndFilter[F ~uint8, T any](c *statementCompiler, filter database.AndFilter[F], schema database.Schema[F, T]) {
	if len(filter.Filters) == 0 {
		return
	}
	if len(filter.Filters) == 1 {
		compileFilter(c, filter.Filters[0], schema)
		return
	}

	c.WriteString("(")
	for i, child := range filter.Filters {
		if i > 0 {
			c.WriteString(" AND ")
		}
		compileFilter(c, child, schema)
	}
	c.WriteString(")")
}

func compileOrFilter[F ~uint8, T any](c *statementCompiler, filter database.OrFilter[F], schema database.Schema[F, T]) {
	if len(filter.Filters) == 0 {
		return
	}
	if len(filter.Filters) == 1 {
		compileFilter(c, filter.Filters[0], schema)
		return
	}

	c.WriteString("(")
	for i, child := range filter.Filters {
		if i > 0 {
			c.WriteString(" OR ")
		}
		compileFilter(c, child, schema)
	}
	c.WriteString(")")
}

func compileCompareFilter[F ~uint8, T any](c *statementCompiler, filter *database.CompareFilter[F], schema database.Schema[F, T]) {
	if compare.NeedsNullAware(filter, schema) {
		compare.CompileNullAware(c, filter, schema, func(_ compare.Writer, arg any, _ database.Column[F]) {
			writeArg(c, arg)
		})
		return
	}
	if compare.CompileBoolEqual(c, filter, schema) {
		return
	}

	op := compareOpSQL(filter.Op)
	if len(filter.Terms) == 1 {
		writeCompareTerm(c, filter.Terms[0], op, schema)
		return
	}

	// GoogleSQL defines no ordering over structs, so the row-value comparison
	// postgres uses is expanded: equality into a conjunction, and an ordered
	// comparison into its lexicographic form,
	// "(a > x) OR (a = x AND b > y)".
	if filter.Op == database.OpEqual {
		c.WriteString("(")
		for i, term := range filter.Terms {
			if i > 0 {
				c.WriteString(" AND ")
			}
			writeCompareTerm(c, term, op, schema)
		}
		c.WriteString(")")
		return
	}

	c.WriteString("(")
	for i, term := range filter.Terms {
		if i > 0 {
			c.WriteString(" OR ")
		}
		c.WriteString("(")
		for _, prefix := range filter.Terms[:i] {
			writeCompareTerm(c, prefix, " = ", schema)
			c.WriteString(" AND ")
		}
		writeCompareTerm(c, term, op, schema)
		c.WriteString(")")
	}
	c.WriteString(")")
}

func writeCompareTerm[F ~uint8, T any](c *statementCompiler, term database.CompareTerm[F], op string, schema database.Schema[F, T]) {
	c.WriteString(schema.SQLName(term.Column))
	c.WriteString(op)
	writeArg(c, term.Value)
}

func compileArrayContainsFilter[F ~uint8, T any](c *statementCompiler, filter *database.ArrayContainsFilter[F], schema database.Schema[F, T]) {
	writeArg(c, filter.Value)
	c.WriteString(" IN UNNEST(")
	c.WriteString(schema.SQLName(filter.Column))
	c.WriteString(")")
}

func compareOpSQL(op database.CompareOp) string {
	switch op {
	case database.OpEqual:
		return " = "
	case database.OpGreater:
		return " > "
	case database.OpLess:
		return " < "
	case database.OpGreaterOrEqual:
		return " >= "
	default:
		panic("unknown compare op")
	}
}

func compileStringFilter[F ~uint8, T any](c *statementCompiler, filter *database.StringFilter[F], schema database.Schema[F, T]) {
	col := schema.SQLName(filter.Column)
	switch filter.Match {
	case database.StringMatchEqual:
		if filter.IgnoreCase {
			c.WriteString("LOWER(")
			c.WriteString(col)
			c.WriteString(") = LOWER(")
			writeArg(c, filter.Value)
			c.WriteString(")")
		} else {
			c.WriteString(col)
			c.WriteString(" = ")
			writeArg(c, filter.Value)
		}
	case database.StringMatchStartsWith, database.StringMatchContains, database.StringMatchEndsWith:
		pattern.CompileLikeMatch(c, col, filter.Match, filter.Value, filter.IgnoreCase)
	default:
		panic("unknown string match")
	}
}

func compileOrderBy[F ~uint8, T any](c *statementCompiler, orderBy database.OrderBy[F], schema database.Schema[F, T]) {
	if len(orderBy.Columns) > 0 {
		c.WriteString(" ORDER BY ")
		for i, column := range orderBy.Columns {
			if i > 0 {
				c.WriteString(", ")
			}
			// Spanner rejects explicit NULLS FIRST/LAST but always orders
			// NULLs first on ASC and last on DESC, the policy the other
			// dialects state via compare.WriteNullsOrder.
			c.WriteString(schema.SQLName(column))
			if orderBy.Direction == database.OrderDesc {
				c.WriteString(" DESC")
			}
		}
	}
}

func compileLimit(c *statementCompiler, limit uint32) {
	if limit > 0 {
		c.WriteString(" LIMIT ")
		writeArg(c, int64(limit))
	}
}

func (c *statementCompiler) WriteString(s string) {
	c.Builder.WriteString(s)
}

func (c *statementCompiler) WriteArg(arg any) {
	writeArg(c, arg)
}

func writeArg(c *statementCompiler, arg any) {
	c.args = append(c.args, arg)
	c.WriteString("@p")
	c.WriteString(strconv.Itoa(len(c.args)))
}

func buildStatement(sql string, args ...any) spannerStatement {
	params := make(map[string]any, len(args))
	for i, arg := range args {
		params[paramName(i+1)] = arg
	}
	return spannerStatement{SQL: sql, Params: params}
}

func paramName(index int) string {
	return "p" + strconv.Itoa(index)
}

type spannerStatement struct {
	SQL    string
	Params map[string]any
}
