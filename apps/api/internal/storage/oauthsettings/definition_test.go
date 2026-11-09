package oauthsettings_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/oauthsettings"
)

func TestMarshalAndToDomain(t *testing.T) {
	t.Parallel()
	in := &domain.OAuthSettings{
		ProjectID: "proj_1",
		ID:        "oauthset_1",
		Enabled:   true,
		CreatedAt: time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC),
	}

	raw, err := oauthsettings.Marshal(in)
	require.NoError(t, err)
	assert.JSONEq(t, `{"enabled":true}`, string(raw))

	got, err := oauthsettings.ToDomain(in.ProjectID, in.ID, in.CreatedAt, raw)
	require.NoError(t, err)
	assert.Equal(t, in, got)
}

// A disabled revision is stored as an explicit false, never as an absent
// field, so a reader cannot mistake it for a revision from before the field
// existed.
func TestMarshalWritesDisabledExplicitly(t *testing.T) {
	t.Parallel()
	raw, err := oauthsettings.Marshal(&domain.OAuthSettings{})
	require.NoError(t, err)
	assert.JSONEq(t, `{"enabled":false}`, string(raw))
}

func TestToDomainRejectsMalformedDefinition(t *testing.T) {
	t.Parallel()
	_, err := oauthsettings.ToDomain("proj_1", "oauthset_1", time.Now(), []byte(`{`))
	require.Error(t, err)
}
