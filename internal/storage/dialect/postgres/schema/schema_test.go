package schema_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/storage/dialect/postgres/schema"
)

func TestValidate(t *testing.T) {
	t.Parallel()

	for _, s := range []string{schema.Default, "pr_42", "_x", "a", strings.Repeat("a", 63)} {
		assert.NoError(t, schema.Validate(s), s)
	}
	for _, s := range []string{"", "PR_42", "pr-42", "42pr", "pr 42", `pr";drop`, "pr.42", strings.Repeat("a", 64)} {
		assert.Error(t, schema.Validate(s), s)
	}
}

func TestRewrite(t *testing.T) {
	t.Parallel()

	const stmt = "INSERT INTO zitadel_nextgen.users (id) VALUES ($1::zitadel_nextgen.user_kinds) -- zitadel_nextgen_like"

	assert.Equal(t, stmt, schema.Rewrite(stmt, schema.Default), "the default schema leaves the statement untouched")
	assert.Equal(t,
		"INSERT INTO pr_42.users (id) VALUES ($1::pr_42.user_kinds) -- zitadel_nextgen_like",
		schema.Rewrite(stmt, "pr_42"),
		"every qualifier moves, an identifier that merely starts with the schema stays")
	assert.Equal(t, "CREATE SCHEMA IF NOT EXISTS pr_42;", schema.Rewrite("CREATE SCHEMA IF NOT EXISTS zitadel_nextgen;", "pr_42"))
	assert.Equal(t, "table_schema = 'pr_42'", schema.Rewrite("table_schema = 'zitadel_nextgen'", "pr_42"))
}
