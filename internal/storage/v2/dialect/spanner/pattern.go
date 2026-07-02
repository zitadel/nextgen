package spanner

import (
	"strings"

	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// escapeLikePattern escapes % and _ in a LIKE pattern literal.
func escapeLikePattern(value string) string {
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

func compileLikePattern(c *statementCompiler, match database.StringMatch, value string) {
	escaped := escapeLikePattern(value)
	switch match {
	case database.StringMatchStartsWith:
		writeArg(c, escaped)
		c.WriteString(" || '%'")
	case database.StringMatchContains:
		c.WriteString("'%' || ")
		writeArg(c, escaped)
		c.WriteString(" || '%'")
	case database.StringMatchEndsWith:
		c.WriteString("'%' || ")
		writeArg(c, escaped)
	case database.StringMatchEqual:
		writeArg(c, escaped)
	default:
		panic("unknown string match")
	}
}
