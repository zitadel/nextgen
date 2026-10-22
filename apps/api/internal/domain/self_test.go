package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestSelfFromSession(t *testing.T) {
	t.Parallel()

	now := time.Now()
	past, future := now.Add(-time.Hour), now.Add(time.Hour)

	self, err := domain.SelfFromSession(&domain.Token{ProjectID: "proj_1", UserID: "user_1", ExpiresAt: &future}, now)
	require.NoError(t, err)
	assert.Equal(t, "proj_1", self.ProjectID())
	assert.Equal(t, "user_1", self.UserID())

	for name, token := range map[string]*domain.Token{
		"no session": nil,
		"expired":    {ProjectID: "proj_1", UserID: "user_1", ExpiresAt: &past},
		"anonymous":  {ProjectID: "proj_1", ExpiresAt: &future},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := domain.SelfFromSession(token, now)
			assert.ErrorIs(t, err, domain.ErrSessionTokenInvalid())
		})
	}
}
