package postgres

import (
	"strconv"
	"strings"

	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

type statementCompiler struct {
	strings.Builder
	args []any
}

func compileRead[F ~uint8, T any](c *statementCompiler, stmt string, opt *database.ListOptions[F], schema database.Schema[F, T]) error {
	c.WriteString(stmt)

	if len(opt.Pagination.Cursor) != 0 {
		cursor, err := pagination.CursorFromToken[F](opt.Pagination.Cursor)
		if err != nil {
			return database.ErrInvalidCursor()
		}
		if !cursor.MatchesOrderBy(opt.Pagination.OrderBy.Columns) {
			return database.ErrCursorOrderMismatch()
		}
		values, err := schema.CoerceCursorValues(cursor.Columns, cursor.Values)
		if err != nil {
			return database.ErrInvalidCursor().WithParent(err)
		}
		terms := compareTerms(cursor.Columns, values)
		if opt.Pagination.OrderBy.Direction == database.OrderAsc {
			opt.Filter = database.And(opt.Filter, database.CompareGreater(terms...))
		} else {
			opt.Filter = database.And(opt.Filter, database.CompareLess(terms...))
		}
	}
	if opt.Filter != nil {
		c.WriteString(" WHERE ")
		compileFilter(c, opt.Filter, schema)
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
	op := compareOpSQL(filter.Op)
	if len(filter.Terms) == 1 {
		c.WriteString(schema.SQLName(filter.Terms[0].Column))
		c.WriteString(op)
		writeArg(c, filter.Terms[0].Value)
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
		writeArg(c, term.Value)
	}
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
		pattern := likePattern(filter.Match, filter.Value)
		if filter.IgnoreCase {
			c.WriteString(col)
			c.WriteString(" ILIKE ")
		} else {
			c.WriteString(col)
			c.WriteString(" LIKE ")
		}
		writeArg(c, pattern)
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
		}
	}
}

func compileLimit(c *statementCompiler, limit uint32) {
	if limit > 0 {
		c.WriteString(" LIMIT ")
		writeArg(c, limit)
	}
}

func writeArgs(c *statementCompiler, args ...any) {
	for i, arg := range args {
		if i > 0 {
			c.WriteString(", ")
		}
		writeArg(c, arg)
	}
}

func writeArg(c *statementCompiler, arg any) {
	c.args = append(c.args, arg)
	c.WriteString("$")
	c.WriteString(strconv.Itoa(len(c.args)))
}
