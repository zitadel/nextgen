package database

import "slices"

// jsonRenderer renders dialect-specific JSON access syntax.
// Only Postgres is implemented today; a Spanner renderer (emitting JSON_VALUE(...))
// can be added and selected per dialect without touching the rest of the package.
type jsonRenderer interface {
	// writeExtract writes a text extraction of path from the base column into the builder.
	// When cast is non-empty the extracted text is cast to that SQL type (e.g. "numeric").
	writeExtract(builder *StatementBuilder, base Column, path []string, cast string)
}

// defaultJSONRenderer is used by the exported JSON constructors.
var defaultJSONRenderer jsonRenderer = postgresJSONRenderer{}

// postgresJSONRenderer renders JSON access using the operators native to the
// Postgres `json` type (`->` and `->>`). No `jsonb`-only operators are used.
type postgresJSONRenderer struct{}

func (postgresJSONRenderer) writeExtract(builder *StatementBuilder, base Column, path []string, cast string) {
	if cast != "" {
		builder.WriteString("(")
	}
	base.WriteQualified(builder)
	for i, key := range path {
		// Intermediate keys navigate as json (->); the last key extracts text (->>).
		if i == len(path)-1 {
			builder.WriteString("->>")
		} else {
			builder.WriteString("->")
		}
		// The key is written as a bound argument to stay injection-safe.
		builder.WriteArg(key)
	}
	if cast != "" {
		builder.WriteString(")::")
		builder.WriteString(cast)
	}
}

// jsonColumn represents text access into a JSON column at a key path.
// The base column is injected (e.g. NewColumn(table, "payload")), so it is
// table-qualified and dialect-selected like any other column.
type jsonColumn struct {
	column   Column
	path     []string
	cast     string // "" = plain text extraction; otherwise the SQL type to cast to.
	renderer jsonRenderer
}

// JSONText returns a column that extracts the value at path from col as text (Postgres ->>).
func JSONText(col Column, path ...string) Column {
	return jsonColumn{column: col, path: path, renderer: defaultJSONRenderer}
}

// jsonNumeric returns a column that extracts the value at path from col and casts it to numeric.
func jsonNumeric(col Column, path ...string) Column {
	return jsonColumn{column: col, path: path, cast: "numeric", renderer: defaultJSONRenderer}
}

// Matches implements [Column].
func (c jsonColumn) Matches(x any) bool {
	toMatch, ok := x.(jsonColumn)
	if !ok {
		return false
	}
	return c.equal(toMatch)
}

// String implements [Column].
func (c jsonColumn) String() string {
	return "database.jsonColumn"
}

// WriteQualified implements [Column].
func (c jsonColumn) WriteQualified(builder *StatementBuilder) {
	c.renderer.writeExtract(builder, c.column, c.path, c.cast)
}

// WriteUnqualified implements [Column].
func (c jsonColumn) WriteUnqualified(builder *StatementBuilder) {
	c.WriteQualified(builder)
}

// Equals implements [Column].
func (c jsonColumn) Equals(col Column) bool {
	if col == nil {
		return false
	}
	toMatch, ok := col.(jsonColumn)
	if !ok {
		return false
	}
	return c.equal(toMatch)
}

func (c jsonColumn) equal(toMatch jsonColumn) bool {
	if c.cast != toMatch.cast || !slices.Equal(c.path, toMatch.path) {
		return false
	}
	if c.column == nil {
		return toMatch.column == nil
	}
	return c.column.Equals(toMatch.column)
}

// WriteArg implements [Column].
func (c jsonColumn) WriteArg(builder *StatementBuilder) {
	c.WriteQualified(builder)
}

var _ Column = (jsonColumn{})
