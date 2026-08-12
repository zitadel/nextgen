package pattern

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type testCompiler struct {
	strings.Builder
	args []any
}

func (c *testCompiler) WriteString(s string) {
	c.Builder.WriteString(s)
}

func (c *testCompiler) WriteArg(arg any) {
	c.args = append(c.args, arg)
	c.WriteString("?")
}

func TestEscapeLikePattern(t *testing.T) {
	t.Parallel()

	assert.Equal(t, `plain`, EscapeLikePattern("plain"))
	assert.Equal(t, `\%100`, EscapeLikePattern("%100"))
	assert.Equal(t, `a\_b`, EscapeLikePattern("a_b"))
	assert.Equal(t, `\\path`, EscapeLikePattern(`\path`))
}

func TestCompileLikePattern(t *testing.T) {
	t.Parallel()

	var c testCompiler

	c.Reset()
	c.args = nil
	CompileLikePattern(&c, database.StringMatchStartsWith, "acme")
	assert.Equal(t, `? || '%'`, c.String())
	assert.Equal(t, []any{"acme"}, c.args)

	c.Reset()
	c.args = nil
	CompileLikePattern(&c, database.StringMatchContains, "login")
	assert.Equal(t, `'%' || ? || '%'`, c.String())
	assert.Equal(t, []any{"login"}, c.args)

	c.Reset()
	c.args = nil
	CompileLikePattern(&c, database.StringMatchEndsWith, "suffix")
	assert.Equal(t, `'%' || ?`, c.String())
	assert.Equal(t, []any{"suffix"}, c.args)

	c.Reset()
	c.args = nil
	CompileLikePattern(&c, database.StringMatchEqual, "exact")
	assert.Equal(t, `?`, c.String())
	assert.Equal(t, []any{"exact"}, c.args)

	c.Reset()
	c.args = nil
	CompileLikePattern(&c, database.StringMatchContains, "100%")
	assert.Equal(t, `'%' || ? || '%'`, c.String())
	assert.Equal(t, []any{"100\\%"}, c.args)
}

func TestCompileLikeMatch(t *testing.T) {
	t.Parallel()

	var c testCompiler
	CompileLikeMatch(&c, "name", database.StringMatchContains, "login", false)
	assert.Equal(t, `name LIKE '%' || ? || '%'`, c.String())
	assert.Equal(t, []any{"login"}, c.args)

	c.Reset()
	c.args = nil
	CompileLikeMatch(&c, "name", database.StringMatchContains, "100%", true)
	assert.Equal(t, `LOWER(name) LIKE LOWER('%' || ? || '%')`, c.String())
	assert.Equal(t, []any{`100\%`}, c.args)
}
