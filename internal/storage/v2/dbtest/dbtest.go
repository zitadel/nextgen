// Package dbtest provides shared bring-up of databases for v2 storage
// integration test suites.
//
// Helpers return already-connected v2 pools with migrations applied (via the
// v2 pool's Migrate API).
package dbtest
