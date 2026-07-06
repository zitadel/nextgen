package spanner

import "strings"

// convertPlaceholders translates $1, $2, ... to @pN for the native Spanner client.
// Skips replacements inside single-quoted string literals.
func convertPlaceholders(sql string) string {
	var b strings.Builder
	b.Grow(len(sql))
	inQuote := false
	i := 0
	for i < len(sql) {
		ch := sql[i]
		if ch == '\'' {
			inQuote = !inQuote
			b.WriteByte(ch)
			i++
			continue
		}
		if !inQuote && ch == '$' && i+1 < len(sql) && isDigit(sql[i+1]) {
			b.WriteString("@p")
			i++ // skip '$'
			for i < len(sql) && isDigit(sql[i]) {
				b.WriteByte(sql[i])
				i++
			}
			continue
		}
		b.WriteByte(ch)
		i++
	}
	return b.String()
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }
