package postgres

import (
	"strconv"
	"strings"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type statementCompiler struct {
	strings.Builder
	args []any
}

func (c *statementCompiler) compileRead(stmt string, opt *database.ListOptions) {
	c.WriteString(stmt)

	if opt.Pagination.After != nil {
		if opt.Pagination.After.OrderBy.Direction == database.OrderAsc {
			opt.Filter = database.And(opt.Filter, database.GreaterThans(opt.Pagination.After.OrderBy.Columns, opt.Pagination.After.Values))
		} else {
			opt.Filter = database.And(opt.Filter, database.LessThans(opt.Pagination.After.OrderBy.Columns, opt.Pagination.After.Values))
		}
	}
	if opt.Filter != nil {
		c.WriteString(" WHERE ")
		c.compileFilter(opt.Filter)
	}

	if opt.Pagination.After != nil {
		c.compilePagination(opt.Pagination.After.OrderBy, opt.Pagination.After.Limit)
	} else {
		c.compilePagination(opt.Pagination.OrderBy, opt.Pagination.Limit)
	}
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

func (c *statementCompiler) compilePagination(orderBy database.OrderBy, limit uint32) {
	if len(orderBy.Columns) > 0 {
		c.WriteString(" ORDER BY ")
		for i, column := range orderBy.Columns {
			if i > 0 {
				c.WriteString(", ")
			}
			c.WriteString(compileColumnName(column))
		}
		if orderBy.Direction != database.OrderAsc {
			c.WriteString(" DESC")
		}
	}

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
	switch col := column.(type) {
	case domain.ProjectField:
		switch col {
		case domain.ProjectFieldID:
			return "id"
		case domain.ProjectFieldCreatedAt:
			return "created_at"
		case domain.ProjectFieldUpdatedAt:
			return "updated_at"
		case domain.ProjectFieldProjectSecret:
			return "project_secret"
		case domain.ProjectFieldPreviewSecret:
			return "preview_secret"
		case domain.ProjectFieldPreviewOrigins:
			return "preview_origins"
		default:
			panic("unknown column type")
		}
	case domain.FlowDefinitionField:
		switch col {
		case domain.FlowDefinitionFieldProjectID:
			return "project_id"
		case domain.FlowDefinitionFieldID:
			return "id"
		case domain.FlowDefinitionFieldName:
			return "name"
		case domain.FlowDefinitionFieldSchemaVersion:
			return "schema_version"
		case domain.FlowDefinitionFieldStatus:
			return "status"
		case domain.FlowDefinitionFieldCreatedAt:
			return "created_at"
		case domain.FlowDefinitionFieldUpdatedAt:
			return "updated_at"
		case domain.FlowDefinitionFieldUserSchema:
			return "user_schema"
		case domain.FlowDefinitionFieldPurposes:
			return "purposes"
		case domain.FlowDefinitionFieldAudience:
			return "audience"
		case domain.FlowDefinitionFieldSteps:
			return "steps"
		default:
			panic("unknown column type")
		}
	default:
		panic("unknown column type")
	}
}
