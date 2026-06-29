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

func TestLikePattern(t *testing.T) {
	t.Parallel()

	assert.Equal(t, `acme%`, likePattern(database.StringMatchStartsWith, "acme"))
	assert.Equal(t, `%login%`, likePattern(database.StringMatchContains, "login"))
	assert.Equal(t, `%suffix`, likePattern(database.StringMatchEndsWith, "suffix"))
	assert.Equal(t, `%100\%%`, likePattern(database.StringMatchContains, "100%"))
}
