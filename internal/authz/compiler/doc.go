// Package compiler turns a profile-valid authz model into storage-neutral
// catalog mutations and query-plan metadata.
//
// The output deliberately carries no catalog ID, version ID, SQL, or dialect
// types. Issue #422 owns the relational schema and maps these records into
// PostgreSQL, Spanner, and SQLite rows.
package compiler
