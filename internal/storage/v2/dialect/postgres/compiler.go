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
		if opt.Pagination.OrderBy.Direction == database.OrderAsc {
			opt.Filter = database.And(opt.Filter, database.GreaterThans(cursor.Columns, cursor.Values))
		} else {
			opt.Filter = database.And(opt.Filter, database.LessThans(cursor.Columns, cursor.Values))
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

func compileFilter[F ~uint8, T any](c *statementCompiler, filter database.Filter[F], schema database.Schema[F, T]) {
	if filter == nil {
		return
	}

	switch f := filter.(type) {
	case database.AndFilter[F]:
		compileAndFilter(c, f, schema)
	case database.OrFilter[F]:
		compileOrFilter(c, f, schema)
	case *database.EqualsFilter[F]:
		compileFilterClause(c, f.Columns, f.Values, " = ", schema)
	case *database.GreaterThanFilter[F]:
		compileFilterClause(c, f.Columns, f.Values, " > ", schema)
	case *database.LessThanFilter[F]:
		compileFilterClause(c, f.Columns, f.Values, " < ", schema)
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

func compileFilterClause[F ~uint8, T any](c *statementCompiler, columns []database.Column[F], values []any, operator string, schema database.Schema[F, T]) {
	if columns == nil || len(columns) != len(values) {
		// TODO: error handling
		return
	}

	if len(columns) > 1 {
		c.WriteString(" (")
	}
	for i, column := range columns {
		if i > 0 {
			c.WriteString(", ")
		}
		c.WriteString(schema.SQLName(column))
	}
	if len(columns) > 1 {
		c.WriteString(")")
	}

	c.WriteString(operator)

	if len(values) > 1 {
		c.WriteString("(")
	}
	writeArgs(c, values...)
	if len(values) > 1 {
		c.WriteString(")")
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
