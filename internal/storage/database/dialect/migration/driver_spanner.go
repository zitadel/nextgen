//go:build spanner

// Build with -tags spanner to include the Spanner sql driver.
// Kept in a separate file because go-sql-spanner pulls in the full
// google-cloud-go/spanner dependency tree; keeping it opt-in avoids that
// cost for builds that only target PostgreSQL.
//
// Required additional dependency (not in go.mod by default):
//
//	go get github.com/googleapis/go-sql-spanner
package migration

import _ "github.com/googleapis/go-sql-spanner"
