// Package stmttest holds shared behavioral integration tests for v2 statement
// implementations.
//
// Suites assert domain-visible behavior through [service.AllStatements], not
// dialect SQL. Dialects register via build tags; TestMain brings up every
// registered dialect and [runTest] loops them:
//
//	go test -tags postgres_integration ./internal/storage/v2/stmttest/
//	go test -tags spanner_integration ./internal/storage/v2/stmttest/
//	go test -tags 'postgres_integration,spanner_integration' ./internal/storage/v2/stmttest/
package stmttest
