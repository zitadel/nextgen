package pattern

import (
	"strings"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// Compiler is the minimal surface dialect statement compilers need to provide
// for shared LIKE-pattern SQL generation.
type Compiler interface {
	WriteString(string)
	WriteArg(any)
}

// EscapeLikePattern escapes %, _, and \ in a LIKE/ILIKE pattern literal.
func EscapeLikePattern(value string) string {
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range value {
		switch r {
		case '%', '_', '\\':
			b.WriteRune('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// CompileLikeMatch writes a LIKE comparison of col against the match pattern
// for value. Ignore-case folds both sides with the database's LOWER: a
// Go-folded needle can disagree with LOWER(col) on non-ASCII (ASCII-only
// SQLite LOWER, C-locale postgres) and miss rows. A single fold function
// means a needle equal to the stored text always matches; characters LOWER
// cannot fold stay case-sensitive.
func CompileLikeMatch(c Compiler, col string, match database.StringMatch, value string, ignoreCase bool) {
	if ignoreCase {
		c.WriteString("LOWER(")
		c.WriteString(col)
		c.WriteString(") LIKE LOWER(")
		CompileLikePattern(c, match, value)
		c.WriteString(")")
		return
	}
	c.WriteString(col)
	c.WriteString(" LIKE ")
	CompileLikePattern(c, match, value)
}

// CompileLikePattern writes a dialect-agnostic LIKE pattern expression using
// WriteArg for the escaped value and WriteString for SQL fragments.
func CompileLikePattern(c Compiler, match database.StringMatch, value string) {
	escaped := EscapeLikePattern(value)
	switch match {
	case database.StringMatchStartsWith:
		c.WriteArg(escaped)
		c.WriteString(" || '%'")
	case database.StringMatchContains:
		c.WriteString("'%' || ")
		c.WriteArg(escaped)
		c.WriteString(" || '%'")
	case database.StringMatchEndsWith:
		c.WriteString("'%' || ")
		c.WriteArg(escaped)
	case database.StringMatchEqual:
		c.WriteArg(escaped)
	default:
		panic("unknown string match")
	}
}
