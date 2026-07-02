package postgres

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestEscapeLikePattern(t *testing.T) {
	t.Parallel()

	assert.Equal(t, `plain`, escapeLikePattern("plain"))
	assert.Equal(t, `\%100`, escapeLikePattern("%100"))
	assert.Equal(t, `a\_b`, escapeLikePattern("a_b"))
	assert.Equal(t, `\\path`, escapeLikePattern(`\path`))
}

func TestCompileLikePattern(t *testing.T) {
	t.Parallel()

	var c statementCompiler

	c.Reset()
	compileLikePattern(&c, database.StringMatchStartsWith, "acme")
	assert.Equal(t, `$1 || '%'`, c.String())
	assert.ElementsMatch(t, c.args, []any{"acme"})

	c.Reset()
	compileLikePattern(&c, database.StringMatchContains, "login")
	assert.Equal(t, `'%' || $1 || '%'`, c.String())
	assert.ElementsMatch(t, c.args, []any{"login"})

	c.Reset()
	compileLikePattern(&c, database.StringMatchEndsWith, "suffix")
	assert.Equal(t, `'%' || $1`, c.String())
	assert.ElementsMatch(t, c.args, []any{"suffix"})

	c.Reset()
	compileLikePattern(&c, database.StringMatchEqual, "exact")
	assert.Equal(t, `$1`, c.String())
	assert.ElementsMatch(t, c.args, []any{"exact"})

	c.Reset()
	compileLikePattern(&c, database.StringMatchContains, "100%")
	assert.Equal(t, `'%' || $1 || '%'`, c.String())
	assert.ElementsMatch(t, c.args, []any{"100\\%"})
}
