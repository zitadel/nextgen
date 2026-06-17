package compile

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/zitadel/nextgen/internal/storage/v2/query"
	"github.com/zitadel/nextgen/internal/storage/v2/query/flowdefinition"
)

const tableFlowDefinitions = "flow_definitions"

var columnSQL = map[flowdefinition.Column]string{
	flowdefinition.ColProjectID:     tableFlowDefinitions + ".project_id",
	flowdefinition.ColID:            tableFlowDefinitions + ".id",
	flowdefinition.ColName:          tableFlowDefinitions + ".name",
	flowdefinition.ColSchemaVersion: tableFlowDefinitions + ".schema_version",
	flowdefinition.ColStatus:        tableFlowDefinitions + ".status",
	flowdefinition.ColPurposes:      tableFlowDefinitions + ".purposes",
	flowdefinition.ColDefinition:    tableFlowDefinitions + ".definition",
	flowdefinition.ColCreatedAt:     tableFlowDefinitions + ".created_at",
	flowdefinition.ColUpdatedAt:     tableFlowDefinitions + ".updated_at",
}

// Compiled holds generated SQL and positional arguments for the sql.DB bridge.
type Compiled struct {
	SQL  string
	Args []any
}

// ArgBag collects positional arguments ($1, $2, ...).
type ArgBag struct {
	Args []any
}

func (b *ArgBag) Add(v any) string {
	b.Args = append(b.Args, v)
	return "$" + strconv.Itoa(len(b.Args))
}

// Compiler generates Spanner SQL from the portable query AST.
type Compiler struct{}

func (Compiler) Column(col flowdefinition.Column) string {
	return columnSQL[col]
}

func (c Compiler) CompileList(
	baseSelect string,
	opts query.ListOptions[flowdefinition.Column],
) (Compiled, error) {
	bag := &ArgBag{}
	var b strings.Builder
	b.WriteString(strings.TrimSpace(baseSelect))

	if opts.Filter != nil {
		where, err := c.compileFilter(opts.Filter, bag)
		if err != nil {
			return Compiled{}, err
		}
		if where != "" {
			b.WriteString(" WHERE ")
			b.WriteString(where)
		}
	}

	if cursor, ok := opts.Page.(query.PageCursor[flowdefinition.Column]); ok && cursor.After != nil {
		keyset, err := compileKeyset(opts.OrderBy, cursor.After, bag)
		if err != nil {
			return Compiled{}, err
		}
		if opts.Filter != nil {
			b.WriteString(" AND ")
		} else {
			b.WriteString(" WHERE ")
		}
		b.WriteString(keyset)
	}

	if err := writeOrderBy(&b, opts.OrderBy); err != nil {
		return Compiled{}, err
	}

	switch page := opts.Page.(type) {
	case query.PageLimit:
		if page.Limit > 0 {
			b.WriteString(" LIMIT ")
			b.WriteString(bag.Add(page.Limit))
		}
		if page.Offset > 0 {
			b.WriteString(" OFFSET ")
			b.WriteString(bag.Add(page.Offset))
		}
	case query.PageCursor[flowdefinition.Column]:
		if page.Limit > 0 {
			b.WriteString(" LIMIT ")
			b.WriteString(bag.Add(page.Limit))
		}
	}

	return Compiled{SQL: b.String(), Args: bag.Args}, nil
}

func (c Compiler) compileFilter(filter query.Filter, bag *ArgBag) (string, error) {
	switch f := filter.(type) {
	case query.AndFilter:
		return compileAnd(c, f, bag)
	case query.OrFilter:
		return compileOr(c, f, bag)
	case query.TextEqualsFilter[flowdefinition.Column]:
		return c.Column(f.Column) + " = " + bag.Add(f.Value), nil
	case query.EnumEqualsFilter[flowdefinition.Column]:
		return c.Column(f.Column) + " = " + bag.Add(f.Value), nil
	case query.FlowDefinitionPurposeContains:
		return bag.Add(f.Purpose) + " IN UNNEST(" + c.Column(flowdefinition.ColPurposes) + ")", nil
	default:
		return "", fmt.Errorf("spanner compile: unsupported filter %T", filter)
	}
}

func compileAnd(c Compiler, f query.AndFilter, bag *ArgBag) (string, error) {
	if len(f.Filters) == 0 {
		return "", nil
	}
	parts := make([]string, 0, len(f.Filters))
	for _, child := range f.Filters {
		part, err := c.compileFilter(child, bag)
		if err != nil {
			return "", err
		}
		if part != "" {
			parts = append(parts, part)
		}
	}
	if len(parts) == 0 {
		return "", nil
	}
	if len(parts) == 1 {
		return parts[0], nil
	}
	return "(" + strings.Join(parts, " AND ") + ")", nil
}

func compileOr(c Compiler, f query.OrFilter, bag *ArgBag) (string, error) {
	if len(f.Filters) == 0 {
		return "", nil
	}
	parts := make([]string, 0, len(f.Filters))
	for _, child := range f.Filters {
		part, err := c.compileFilter(child, bag)
		if err != nil {
			return "", err
		}
		if part != "" {
			parts = append(parts, part)
		}
	}
	if len(parts) == 0 {
		return "", nil
	}
	if len(parts) == 1 {
		return parts[0], nil
	}
	return "(" + strings.Join(parts, " OR ") + ")", nil
}

func writeOrderBy(b *strings.Builder, order []query.OrderBy[flowdefinition.Column]) error {
	if len(order) == 0 {
		return nil
	}
	b.WriteString(" ORDER BY ")
	for i, o := range order {
		if i > 0 {
			b.WriteString(", ")
		}
		col, ok := columnSQL[o.Column]
		if !ok {
			return fmt.Errorf("unknown order column %d", o.Column)
		}
		b.WriteString(col)
		if o.Direction == query.OrderDesc {
			b.WriteString(" DESC")
		} else {
			b.WriteString(" ASC")
		}
	}
	return nil
}

func compileKeyset(
	order []query.OrderBy[flowdefinition.Column],
	cursor *query.CursorToken,
	bag *ArgBag,
) (string, error) {
	if cursor == nil {
		return "", nil
	}
	if len(cursor.Values) != len(order) {
		return "", query.ErrInvalidCursor
	}
	cols := make([]string, len(order))
	vals := make([]string, len(order))
	for i, o := range order {
		col, ok := columnSQL[o.Column]
		if !ok {
			return "", fmt.Errorf("unknown keyset column %d", o.Column)
		}
		cols[i] = col
		vals[i] = bag.Add(cursor.Values[i])
	}
	op := ">"
	if allDesc(order) {
		op = "<"
	}
	return "(" + strings.Join(cols, ", ") + ") " + op + " (" + strings.Join(vals, ", ") + ")", nil
}

func allDesc(order []query.OrderBy[flowdefinition.Column]) bool {
	if len(order) == 0 {
		return false
	}
	for _, o := range order {
		if o.Direction != query.OrderDesc {
			return false
		}
	}
	return true
}
