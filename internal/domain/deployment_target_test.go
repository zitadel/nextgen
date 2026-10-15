package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var projectOrigins = []Origin{
	{Pattern: "https://www.acme.com", Kind: OriginKindPrimary},
	{Pattern: "https://app.acme.com", Kind: OriginKindPrimary},
	{Pattern: "https://*-acmeinc.vercel.app", Kind: OriginKindPreview},
}

func TestResolvePrimaryTargets(t *testing.T) {
	t.Run("primary expands to every primary origin", func(t *testing.T) {
		origins, err := ResolvePrimaryTargets(projectOrigins, []string{DeploymentTargetPrimary})
		require.NoError(t, err)
		assert.Equal(t, []string{"https://www.acme.com", "https://app.acme.com"}, origins)
	})

	t.Run("an exact primary origin", func(t *testing.T) {
		origins, err := ResolvePrimaryTargets(projectOrigins, []string{"https://app.acme.com"})
		require.NoError(t, err)
		assert.Equal(t, []string{"https://app.acme.com"}, origins)
	})

	t.Run("primary with no primary origin", func(t *testing.T) {
		_, err := ResolvePrimaryTargets(projectOrigins[2:], []string{DeploymentTargetPrimary})
		assert.Equal(t, ErrDeploymentInvalid(nil, nil).Code, err.(Error).Code)
	})

	t.Run("any other origin is not served yet", func(t *testing.T) {
		_, err := ResolvePrimaryTargets(projectOrigins, []string{"https://acme-git-sso-acmeinc.vercel.app"})
		assert.Equal(t, ErrNotImplemented().Code, err.(Error).Code)
	})
}
