package resolver_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service/mocks"
)

func TestStrongestProjectRole(t *testing.T) {
	t.Parallel()

	boom := errors.New("boom")
	viewer, editor, admin := domain.ProjectRoleViewer, domain.ProjectRoleEditor, domain.ProjectRoleAdmin
	tests := []struct {
		name     string
		granted  []string
		operator bool
		err      error
		// asked are the relations the grant check is asked for, in order.
		asked []string
		want  string
	}{
		{name: "no access costs one check", asked: []string{viewer}},
		{name: "viewer", granted: []string{viewer}, asked: []string{viewer, editor}, want: viewer},
		{name: "editor", granted: []string{viewer, editor}, asked: []string{viewer, editor, admin}, want: editor},
		{name: "admin", granted: []string{viewer, editor, admin}, asked: []string{viewer, editor, admin}, want: admin},
		{name: "platform operator holds admin", operator: true, asked: []string{viewer, editor, admin}, want: admin},
		{name: "check error", err: boom, asked: []string{viewer}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			stmts := mocks.NewMockAuthzResolverStatements(gomock.NewController(t))
			stmts.EXPECT().ActiveSystemCatalogID(gomock.Any()).Return(domain.SystemCatalogID, nil).AnyTimes()
			var asked []string
			stmts.EXPECT().CheckAuthz(gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, params domain.AuthzCheckParams) (bool, bool, error) {
					assert.Equal(t, "project", params.ObjectType)
					asked = append(asked, params.Relation)
					if tt.err != nil {
						return false, false, tt.err
					}
					granted := slices.Contains(tt.granted, params.Relation)
					return granted, granted, nil
				}).AnyTimes()
			stmts.EXPECT().CheckPlatformOperator(gomock.Any(), gomock.Any()).Return(tt.operator, nil).AnyTimes()

			got, err := resolver.New().StrongestProjectRole(t.Context(), stmts, resolver.Request{
				PrincipalType:     domain.AuthzPrincipalTypeUser,
				PrincipalID:       "user_alice",
				ProjectID:         "proj_customer",
				HomeProjectID:     domain.PlatformProjectID,
				PlatformProjectID: domain.PlatformProjectID,
			})
			if tt.err != nil {
				require.ErrorIs(t, err, tt.err)
			} else {
				require.NoError(t, err)
			}
			assert.Equal(t, tt.want, got)
			assert.Equal(t, tt.asked, asked)
		})
	}
}
