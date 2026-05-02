package spanner

import "regexp"

var pgArgRe = regexp.MustCompile(`\$(\d+)`)

// convertPlaceholders translates PostgreSQL-style positional placeholders ($1, $2, ...)
// to the @pN style expected by go-sql-spanner.
func convertPlaceholders(sql string) string {
	return pgArgRe.ReplaceAllString(sql, "@p$1")
}
