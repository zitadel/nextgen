package migration

import (
	"testing"

	"github.com/stretchr/testify/assert"

	pgschema "github.com/zitadel/nextgen/internal/storage/dialect/postgres/schema"
)

func TestLockIDKeepsTheDefaultAndSeparatesSchemas(t *testing.T) {
	t.Parallel()

	assert.Equal(t, migrationLockID, lockID(pgschema.Default), "the default schema keeps the historical lock")
	assert.Equal(t, lockID("pr_42"), lockID("pr_42"), "a schema's lock is stable")
	assert.NotEqual(t, migrationLockID, lockID("pr_42"))
	assert.NotEqual(t, lockID("pr_42"), lockID("pr_43"), "schemas do not share a lock")
}
