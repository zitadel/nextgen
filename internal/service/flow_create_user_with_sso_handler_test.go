package service_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// create_user_with_sso mints a user with no password, so it must only run when
// a provider callback verified an identity. Without the guard, a flow author
// could route a plain submit into it and create an account with no proof of
// identity (raised in review by @vitorbari). These cases pin that the guard
// refuses before touching any storage, so nil dependencies are fine here.
func TestFlowCreateUserWithSso_RefusesWithoutVerifiedIdentity(t *testing.T) {
	t.Parallel()
	handler := service.NewFlowCreateUserWithSsoHandler(nil, nil, nil)

	cases := map[string]*domain.FlowState{
		"nil verified identity": {ProjectID: "proj-1"},
		"empty provider": {
			ProjectID:        "proj-1",
			VerifiedIdentity: &domain.FlowVerifiedIdentity{Subject: "sub-1"},
		},
		"empty subject": {
			ProjectID:        "proj-1",
			VerifiedIdentity: &domain.FlowVerifiedIdentity{Provider: "google"},
		},
	}

	for name, state := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := handler.Handle(t.Context(), domain.FlowOnSuccessInput{
				ProjectID: state.ProjectID,
				State:     state,
			})
			require.Error(t, err)
			require.True(t, errors.Is(err, domain.ErrFlowIntegrity()),
				"create_user_with_sso without a verified identity must be a flow-integrity error, got: %v", err)
		})
	}
}
