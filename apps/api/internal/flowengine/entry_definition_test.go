package flowengine_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/flowengine"
)

func entryDef(name, version string, audience domain.FlowDefinitionAudience, purposes ...domain.FlowDefinitionPurpose) *domain.FlowDefinition {
	entries := make(map[domain.FlowDefinitionPurpose]string, len(purposes))
	for _, purpose := range purposes {
		entries[purpose] = "start"
	}
	return &domain.FlowDefinition{
		ProjectID:     testProjectID,
		ID:            name + "-" + version,
		Name:          name,
		SchemaVersion: version,
		UserSchema:    "human-user",
		Purposes:      entries,
		Audience:      audience,
	}
}

func TestEntryByName_ExactVersion(t *testing.T) {
	t.Parallel()
	want := entryDef("login", "1.2.3", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)

	got, err := flowengine.EntryByName(want, flowengine.EntryCriteria{
		Purpose:       domain.FlowDefinitionPurposeLogin,
		SchemaVersion: new("1.2.3"),
	})
	require.NoError(t, err)
	assert.Same(t, want, got)

	_, err = flowengine.EntryByName(want, flowengine.EntryCriteria{
		Purpose:       domain.FlowDefinitionPurposeLogin,
		SchemaVersion: new("1.0.0"),
	})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionNotFound())
}

func TestEntryByName_PurposeMismatch(t *testing.T) {
	t.Parallel()
	def := entryDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)

	_, err := flowengine.EntryByName(def, flowengine.EntryCriteria{Purpose: domain.FlowDefinitionPurposeRegister})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionPurposeMismatch())
}

func TestEntryByAudience_ReturnsFirstMatchingPurpose(t *testing.T) {
	t.Parallel()
	first := entryDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	second := entryDef("alt", "1.0.0", domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}}, domain.FlowDefinitionPurposeLogin)

	got, err := flowengine.EntryByAudience([]*domain.FlowDefinition{first, second}, flowengine.EntryCriteria{Purpose: domain.FlowDefinitionPurposeLogin})
	require.NoError(t, err)
	assert.Same(t, first, got, "want first definition")
}

func TestEntryByAudience_NoMatch(t *testing.T) {
	t.Parallel()
	def := entryDef("login", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)

	_, err := flowengine.EntryByAudience([]*domain.FlowDefinition{def}, flowengine.EntryCriteria{Purpose: domain.FlowDefinitionPurposeRegister})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionNotFound())
}

func TestEntryByAudience_ExactVersionFiltersOlder(t *testing.T) {
	t.Parallel()
	v1 := entryDef("login-v1", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	v2 := entryDef("login-v2", "2.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)

	got, err := flowengine.EntryByAudience([]*domain.FlowDefinition{v1, v2}, flowengine.EntryCriteria{
		Purpose:       domain.FlowDefinitionPurposeLogin,
		SchemaVersion: new("1.0.0"),
	})
	require.NoError(t, err)
	assert.Same(t, v1, got, "want v1 (exact match)")
}

func TestEntryByAudience_AppHintOutranksTeamAndDefault(t *testing.T) {
	t.Parallel()
	byApp := entryDef("by-app", "1.0.0", domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}}, domain.FlowDefinitionPurposeLogin)
	byTeam := entryDef("by-team", "1.0.0", domain.FlowDefinitionAudience{TeamIDs: []string{"team-1"}}, domain.FlowDefinitionPurposeLogin)
	fallback := entryDef("default", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)

	got, err := flowengine.EntryByAudience([]*domain.FlowDefinition{fallback, byTeam, byApp}, flowengine.EntryCriteria{
		Purpose: domain.FlowDefinitionPurposeLogin,
		Hint:    flowengine.EntryHint{AppID: new("app-1"), TeamID: new("team-1")},
	})
	require.NoError(t, err)
	assert.Same(t, byApp, got, "want the app-scoped definition")
}

func TestEntryByAudience_TeamHintOutranksDefault(t *testing.T) {
	t.Parallel()
	byTeam := entryDef("by-team", "1.0.0", domain.FlowDefinitionAudience{TeamIDs: []string{"team-1"}}, domain.FlowDefinitionPurposeLogin)
	fallback := entryDef("default", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)

	got, err := flowengine.EntryByAudience([]*domain.FlowDefinition{fallback, byTeam}, flowengine.EntryCriteria{
		Purpose: domain.FlowDefinitionPurposeLogin,
		Hint:    flowengine.EntryHint{TeamID: new("team-1")},
	})
	require.NoError(t, err)
	assert.Same(t, byTeam, got, "want the team-scoped definition")
}

// A definition scoped to an app must not capture unhinted requests just by
// being newer — the unscoped project default outranks it.
func TestEntryByAudience_ScopedFlowDoesNotCaptureDefault(t *testing.T) {
	t.Parallel()
	fallback := entryDef("default", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	fallback.CreatedAt = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	scoped := entryDef("kiosk", "1.0.0", domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}}, domain.FlowDefinitionPurposeLogin)
	scoped.CreatedAt = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	got, err := flowengine.EntryByAudience([]*domain.FlowDefinition{scoped, fallback}, flowengine.EntryCriteria{Purpose: domain.FlowDefinitionPurposeLogin})
	require.NoError(t, err)
	assert.Same(t, fallback, got, "want the unscoped default")
}

// Hints are routing suggestions, not a security boundary: when only scoped
// definitions exist and none matches the hint, resolution still succeeds
// rather than failing the sign-in.
func TestEntryByAudience_UnmatchedHintFallsBackToScoped(t *testing.T) {
	t.Parallel()
	scoped := entryDef("kiosk", "1.0.0", domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}}, domain.FlowDefinitionPurposeLogin)

	got, err := flowengine.EntryByAudience([]*domain.FlowDefinition{scoped}, flowengine.EntryCriteria{
		Purpose: domain.FlowDefinitionPurposeLogin,
		Hint:    flowengine.EntryHint{AppID: new("app-2")},
	})
	require.NoError(t, err)
	assert.Same(t, scoped, got, "want the only remaining definition")
}

func TestEntryByAudience_UserSchemaHintFilters(t *testing.T) {
	t.Parallel()
	human := entryDef("human", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	human.CreatedAt = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	machine := entryDef("machine", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	machine.UserSchema = "machine-user"
	machine.CreatedAt = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	candidates := []*domain.FlowDefinition{human, machine}

	got, err := flowengine.EntryByAudience(candidates, flowengine.EntryCriteria{
		Purpose: domain.FlowDefinitionPurposeLogin,
		Hint:    flowengine.EntryHint{UserSchemaID: new("machine-user")},
	})
	require.NoError(t, err)
	assert.Same(t, machine, got, "want the machine-schema definition despite being older")

	_, err = flowengine.EntryByAudience(candidates, flowengine.EntryCriteria{
		Purpose: domain.FlowDefinitionPurposeLogin,
		Hint:    flowengine.EntryHint{UserSchemaID: new("visitor")},
	})
	assert.ErrorIs(t, err, domain.ErrFlowDefinitionNotFound(), "unmatched schema hint")
}

func TestEntryByAudience_NoHintPicksNewestDeterministically(t *testing.T) {
	t.Parallel()
	older := entryDef("older", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	older.CreatedAt = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	newer := entryDef("newer", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	newer.CreatedAt = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	// Both orders yield the same pick — the newest definition.
	for _, candidates := range [][]*domain.FlowDefinition{{older, newer}, {newer, older}} {
		got, err := flowengine.EntryByAudience(candidates, flowengine.EntryCriteria{Purpose: domain.FlowDefinitionPurposeLogin})
		require.NoError(t, err)
		assert.Same(t, newer, got, "want the newest definition")
	}
}

// Colliding created_at timestamps (one bulk apply writing several flows)
// still yield a stable pick: the higher id wins.
func TestEntryByAudience_TimestampCollisionBreaksOnID(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	first := entryDef("aaa", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	first.CreatedAt = at
	second := entryDef("bbb", "1.0.0", domain.FlowDefinitionAudience{}, domain.FlowDefinitionPurposeLogin)
	second.CreatedAt = at

	for _, candidates := range [][]*domain.FlowDefinition{{first, second}, {second, first}} {
		got, err := flowengine.EntryByAudience(candidates, flowengine.EntryCriteria{Purpose: domain.FlowDefinitionPurposeLogin})
		require.NoError(t, err)
		assert.Same(t, second, got, "want the definition with the higher id")
	}
}
