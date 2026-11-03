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
	schema := user.NewSchema("users", "json_schemas")
	col := database.Col(domain.UserFieldLifecycleOwnerTeamID)
	cols := []database.Column[domain.UserField]{col}

	assert.True(t, schema.Nullable(col))
	v := schema.ValuesFrom(&domain.User{}, cols)[0]
	assert.True(t, v == nil, "lifecycle_owner_team_id must bind untyped nil")

	u := &domain.User{LifecycleOwnerTeamID: new("team_1")}
	assert.Equal(t, []any{"team_1"}, schema.ValuesFrom(u, cols))
}
