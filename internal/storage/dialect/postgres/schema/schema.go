// Package schema names the Postgres schema the dialect reads and writes.
//
// Every statement and migration of the Postgres dialect qualifies its
// tables, its types and the goose tracking table with [Default]. A
// deployment can run under another schema instead: the dialect rewrites that
// qualifier on every statement before it reaches the server, and the
// migrations are applied into the configured schema. Several instances can
// share one database that way, and a throwaway environment is one
// CREATE SCHEMA away and one DROP SCHEMA … CASCADE away from being gone.
package schema

import (
	"fmt"
	"regexp"
)

// Default is the schema the statements and migrations are written for.
const Default = "zitadel_nextgen"

// name bounds a configured schema to what can be written into SQL text
// unquoted: a lowercase identifier of at most 63 bytes.
var name = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)

// reference matches the default schema wherever it stands on its own in SQL
// text: as the qualifier of a table or type, in CREATE SCHEMA, or quoted as a
// value. An identifier that merely starts with it is left alone.
var reference = regexp.MustCompile(`\b` + Default + `\b`)

// Validate reports whether s can be used as the schema. It is written into
// SQL text unquoted, so only a plain lowercase identifier is accepted.
func Validate(s string) error {
	if !name.MatchString(s) {
		return fmt.Errorf("postgres: schema %q must match %s", s, name)
	}
	return nil
}

// Rewrite returns sql with every reference to the default schema redirected
// to s. Values are always bound parameters, so the default schema can appear
// in SQL text only where the dialect itself wrote it. The default schema
// returns sql unchanged.
func Rewrite(sql, s string) string {
	if s == Default {
		return sql
	}
	return reference.ReplaceAllLiteralString(sql, s)
}
