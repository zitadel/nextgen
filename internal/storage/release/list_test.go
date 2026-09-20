package release_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/release"
)

func TestNewestFirst(t *testing.T) {
	t.Parallel()

	order := release.NewestFirst()

	assert.Equal(t, database.OrderDesc, order.Direction)
	// id is the tiebreak, so two releases sharing a created_at still page in a
	// stable order rather than whichever the index reaches first.
	assert.Equal(t, []database.Column[domain.ReleaseField]{
		database.Col(domain.ReleaseFieldCreatedAt),
		database.Col(domain.ReleaseFieldID),
	}, order.Columns)
}

func TestListOptionsScopesToProject(t *testing.T) {
	t.Parallel()

	opts := release.ListOptions("proj_1", 20)

	assert.Equal(t, uint32(20), opts.Pagination.Limit)
	assert.Equal(t, release.NewestFirst(), opts.Pagination.OrderBy)
	assert.NotNil(t, opts.Filter)
}
