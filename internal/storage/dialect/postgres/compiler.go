package postgres

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
// (e.g. "zitadel_nextgen.teams", "id"); empty skips authz.
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
		compare.CompileNullAware(c, filter, schema, func(_ compare.Writer, arg any, col database.Column[F]) {
			writeArgWithParamCast(c, arg, schema, col)
		})
		return
	}
	if compare.CompileBoolEqual(c, filter, schema) {
		return
	}

	op := compareOpSQL(filter.Op)
	if len(filter.Terms) == 1 {
		c.WriteString(schema.SQLName(filter.Terms[0].Column))
		c.WriteString(op)
		writeArgWithParamCast(c, filter.Terms[0].Value, schema, filter.Terms[0].Column)
		return
	}

	c.WriteString("(")
	for i, term := range filter.Terms {
		if i > 0 {
			c.WriteString(", ")
		}
		c.WriteString(schema.SQLName(term.Column))
	}
	c.WriteString(")")
	c.WriteString(op)
	c.WriteString("(")
	for i, term := range filter.Terms {
		if i > 0 {
			c.WriteString(", ")
		}
		writeArgWithParamCast(c, term.Value, schema, term.Column)
	}
	c.WriteString(")")
}

func compileArrayContainsFilter[F ~uint8, T any](c *statementCompiler, filter *database.ArrayContainsFilter[F], schema database.Schema[F, T]) {
	writeArgWithParamCast(c, filter.Value, schema, filter.Column)
	c.WriteString(" = ANY(")
	c.WriteString(schema.SQLName(filter.Column))
	c.WriteString(")")
}

func writeArgWithParamCast[F ~uint8, T any](c *statementCompiler, arg any, schema database.Schema[F, T], col database.Column[F]) {
	writeArg(c, arg)
	if cast := schema.ParamCast(col); cast != "" {
		c.WriteString(cast)
	}
}

func compareOpSQL(op database.CompareOp) string {
	switch op {
	case database.OpEqual:
		return " = "
	case database.OpGreater:
		return " > "
	case database.OpLess:
		return " < "
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
		value := filter.Value
		if filter.IgnoreCase {
			c.WriteString("LOWER(")
			c.WriteString(col)
			c.WriteString(")")
			value = strings.ToLower(filter.Value)
		} else {
			c.WriteString(col)
		}
		c.WriteString(" LIKE ")
		pattern.CompileLikePattern(c, filter.Match, value)
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
			c.WriteString(schema.SQLName(column))
			if orderBy.Direction == database.OrderDesc {
				c.WriteString(" DESC")
			}
			compare.WriteNullsOrder(c, column, orderBy.Direction, schema)
		}
	}
}

func compileLimit(c *statementCompiler, limit uint32) {
	if limit > 0 {
		c.WriteString(" LIMIT ")
		writeArg(c, limit)
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
	c.WriteString("$")
	c.WriteString(strconv.Itoa(len(c.args)))
}
