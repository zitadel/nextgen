package user_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/user"
)

// The absent state must bind untyped nil: a typed nil slips past the compare
// compiler's nil checks and binds NULL into an ordered compare.
func TestSchemaNullableBindings(t *testing.T) {
	col := database.Col(domain.UserFieldLifecycleOwnerTeamID)
	cols := []database.Column[domain.UserField]{col}

	assert.True(t, user.Schema.Nullable(col))
	v := user.Schema.ValuesFrom(&domain.User{}, cols)[0]
	assert.True(t, v == nil, "lifecycle_owner_team_id must bind untyped nil")

	u := &domain.User{LifecycleOwnerTeamID: new("team_1")}
	assert.Equal(t, []any{"team_1"}, user.Schema.ValuesFrom(u, cols))
}
