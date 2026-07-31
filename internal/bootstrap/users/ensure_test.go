package users

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"go.uber.org/mock/gomock"
)

func TestEnsureTeam(t *testing.T) {
	readErr := errors.New("connection refused")

	tests := []struct {
		name string
		// expect declares the reads and writes the case allows; an unexpected
		// CreateTeam fails the test on its own.
		expect  func(*servicemocks.MockAllStatements)
		wantErr error
	}{
		{
			name: "existing team is not recreated",
			expect: func(stmts *servicemocks.MockAllStatements) {
				stmts.EXPECT().GetTeamByID(gomock.Any(), "proj_1", "team_1").
					Return(&domain.Team{ProjectID: "proj_1", ID: "team_1"}, nil)
			},
		},
		{
			name: "missing team is created",
			expect: func(stmts *servicemocks.MockAllStatements) {
				stmts.EXPECT().GetTeamByID(gomock.Any(), "proj_1", "team_1").
					Return(nil, database.NewNoRowFoundError(errors.New("no rows")))
				stmts.EXPECT().CreateTeam(gomock.Any(), &domain.Team{
					ProjectID: "proj_1",
					ID:        "team_1",
					Name:      "team-team_1",
				}).Return(nil)
			},
		},
		{
			name: "read failure is returned instead of creating",
			expect: func(stmts *servicemocks.MockAllStatements) {
				stmts.EXPECT().GetTeamByID(gomock.Any(), "proj_1", "team_1").
					Return(nil, readErr)
			},
			wantErr: readErr,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stmts := servicemocks.NewMockAllStatements(gomock.NewController(t))
			tt.expect(stmts)

			err := ensureTeam(t.Context(), stmts, "proj_1", "team_1")
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
		})
	}
}
