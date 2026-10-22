// Package stmttest holds shared behavioral integration tests for v2 statement
// implementations.
//
// Suites assert domain-visible behavior through [service.AllStatements], not
// dialect SQL. Dialects register via build tags; TestMain brings up every
// registered dialect and [forEachDialect] loops them:
//
//	go test -tags postgres_integration ./internal/storage/stmttest/
//	go test -tags spanner_integration ./internal/storage/stmttest/
//	go test -tags sqlite_integration ./internal/storage/stmttest/
//	go test -tags 'postgres_integration,spanner_integration,sqlite_integration' ./internal/storage/stmttest/
package stmttest
