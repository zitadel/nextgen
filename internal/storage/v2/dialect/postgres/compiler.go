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

func (c *statementCompiler) compileRead(stmt string, opt *database.ListOptions) error {
	c.WriteString(stmt)

	if len(opt.Pagination.Cursor) != 0 {
		cursor, err := pagination.CursorFromToken(opt.Pagination.Cursor)
		if err != nil {
			return database.ErrInvalidCursor()
		}
		if !cursor.MatchesOrderBy(opt.Pagination.Columns) {
			return database.ErrCursorOrderMismatch()
		}
		if opt.Pagination.Direction == database.OrderAsc {
			opt.Filter = database.And(opt.Filter, database.GreaterThans(cursor.Columns, cursor.Values))
		} else {
			opt.Filter = database.And(opt.Filter, database.LessThans(cursor.Columns, cursor.Values))
		}
	}
	if opt.Filter != nil {
		c.WriteString(" WHERE ")
		c.compileFilter(opt.Filter)
	}

	c.compileOrderBy(opt.Pagination.OrderBy)
	c.compileLimit(opt.Pagination.Limit)

	return nil
}

func (c *statementCompiler) compileFilter(filter database.Filter) {
	if filter == nil {
		return
	}

	switch f := filter.(type) {
	case *database.AndFilter:
		c.compileAndFilter(f)
	case *database.OrFilter:
		c.compileOrFilter(f)
	case *database.EqualsFilter:
		c.compileFilterClause(f.Columns, f.Values, " = ")
	// case *database.NotEqualFilter[C]:
	// 	c.compileNotEqualFilter(f)
	// case *database.LessThanFilter[C]:
	// 	c.compileLessThanFilter(f)
	// case *database.LessThanOrEqualFilter[C]:
	// 	c.compileLessThanOrEqualFilter(f)
	case *database.GreaterThanFilter:
		c.compileFilterClause(f.Columns, f.Values, " > ")
	// case *database.GreaterThanOrEqualFilter[C]:
	// 	c.compileGreaterThanOrEqualFilter(f)
	default:
		panic("unknown filter type")
	}
}

func (c *statementCompiler) compileAndFilter(filter *database.AndFilter) {
	if len(filter.Filters) == 0 {
		return
	}

	c.WriteString(" (")
	for i, child := range filter.Filters {
		if i > 0 {
			c.WriteString(" AND ")
		}
		c.compileFilter(child)
	}
	c.WriteString(")")
}

func (c *statementCompiler) compileOrFilter(filter *database.OrFilter) {
	if len(filter.Filters) == 0 {
		return
	}

	c.WriteString(" (")
	for i, child := range filter.Filters {
		if i > 0 {
			c.WriteString(" OR ")
		}
		c.compileFilter(child)
	}
	c.WriteString(")")
}

func (c *statementCompiler) compileFilterClause(columns []database.Column, values []any, operator string) {
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
		c.WriteString(compileColumnName(column))
	}
	if len(columns) > 1 {
		c.WriteString(") ")
	}

	c.WriteString(operator)

	if len(values) > 1 {
		c.WriteString("(")
	}
	c.writeArgs(values...)
	if len(values) > 1 {
		c.WriteString(")")
	}
}

func (c *statementCompiler) compileOrderBy(orderBy database.OrderBy) {
	if len(orderBy.Columns) > 0 {
		c.WriteString(" ORDER BY ")
		for i, column := range orderBy.Columns {
			if i > 0 {
				c.WriteString(", ")
			}
			c.WriteString(compileColumnName(column))
			if orderBy.Direction == database.OrderDesc {
				c.WriteString(" DESC")
			}
		}
	}
}

func (c *statementCompiler) compileLimit(limit uint32) {
	if limit > 0 {
		c.WriteString(" LIMIT ")
		c.writeArg(limit)
	}
}

func (c *statementCompiler) writeArgs(args ...any) {
	for i, arg := range args {
		if i > 0 {
			c.WriteString(", ")
		}
		c.writeArg(arg)
	}
}

func (c *statementCompiler) writeArg(arg any) {
	c.args = append(c.args, arg)
	c.WriteString("$")
	c.WriteString(strconv.Itoa(len(c.args)))
}

func compileColumnName(column any) string {
	return "id"
	// switch col := column.(type) {
	// case domain.ProjectField:
	// 	switch col {
	// 	case domain.ProjectFieldID:
	// 		return "id"
	// 	case domain.ProjectFieldCreatedAt:
	// 		return "created_at"
	// 	case domain.ProjectFieldUpdatedAt:
	// 		return "updated_at"
	// 	case domain.ProjectFieldProjectSecret:
	// 		return "project_secret"
	// 	case domain.ProjectFieldPreviewSecret:
	// 		return "preview_secret"
	// 	case domain.ProjectFieldPreviewOrigins:
	// 		return "preview_origins"
	// 	default:
	// 		panic("unknown column type")
	// 	}
	// case domain.FlowDefinitionField:
	// 	switch col {
	// 	case domain.FlowDefinitionFieldProjectID:
	// 		return "project_id"
	// 	case domain.FlowDefinitionFieldID:
	// 		return "id"
	// 	case domain.FlowDefinitionFieldName:
	// 		return "name"
	// 	case domain.FlowDefinitionFieldSchemaVersion:
	// 		return "schema_version"
	// 	case domain.FlowDefinitionFieldStatus:
	// 		return "status"
	// 	case domain.FlowDefinitionFieldCreatedAt:
	// 		return "created_at"
	// 	case domain.FlowDefinitionFieldUpdatedAt:
	// 		return "updated_at"
	// 	case domain.FlowDefinitionFieldUserSchema:
	// 		return "user_schema"
	// 	case domain.FlowDefinitionFieldPurposes:
	// 		return "purposes"
	// 	case domain.FlowDefinitionFieldAudience:
	// 		return "audience"
	// 	case domain.FlowDefinitionFieldSteps:
	// 		return "steps"
	// 	default:
	// 		panic("unknown column type")
	// 	}
	// default:
	// 	panic("unknown column type")
	// }
}
