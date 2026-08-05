package pattern

import (
	"strings"

	"github.com/zitadel/nextgen/internal/storage/v2/database"
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
