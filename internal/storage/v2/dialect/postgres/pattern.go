package postgres

import (
	"strings"

	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// escapeLikePattern escapes % and _ in a LIKE/ILIKE pattern literal.
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

func likePattern(match database.StringMatch, value string) string {
	escaped := escapeLikePattern(value)
	switch match {
	case database.StringMatchStartsWith:
		return escaped + "%"
	case database.StringMatchContains:
		return "%" + escaped + "%"
	case database.StringMatchEndsWith:
		return "%" + escaped
	case database.StringMatchEqual:
		return escaped
	default:
		panic("unknown string match")
	}
}
