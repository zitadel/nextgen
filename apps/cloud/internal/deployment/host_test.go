package deployment

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHost(t *testing.T) {
	for _, name := range []string{HostVariable, "VERCEL_ENV", "VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"} {
		t.Setenv(name, "")
	}
	assert.Empty(t, Host(), "outside Vercel nothing is known")
	t.Setenv("VERCEL_URL", "proj-abc-team.vercel.app")
	assert.Equal(t, "proj-abc-team.vercel.app", Host(), "the deployment URL is the last resort")
	t.Setenv("VERCEL_BRANCH_URL", "proj-git-main-team.vercel.app")
	assert.Equal(t, "proj-git-main-team.vercel.app", Host(), "a branch URL outranks it")
	t.Setenv("VERCEL_PROJECT_PRODUCTION_URL", "cloud.example")
	assert.Equal(t, "proj-git-main-team.vercel.app", Host(), "the production domain only in production")
	t.Setenv("VERCEL_ENV", "production")
	assert.Equal(t, "cloud.example", Host())
	t.Setenv(HostVariable, "preview.example")
	assert.Equal(t, "preview.example", Host(), "an explicit host outranks everything")
}
