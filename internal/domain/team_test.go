package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestNewTeam(t *testing.T) {
	t.Parallel()
	type args struct {
		projectID string
		name      string
	}
	tests := []struct {
		name    string
		args    args
		check   func(t *testing.T, got *domain.Team)
		wantErr error
	}{
		{
			name: "team with name",
			args: args{
				projectID: "proj_1",
				name:      "my-team",
			},
			check: func(t *testing.T, got *domain.Team) {
				assert.Equal(t, "proj_1", got.ProjectID)
				assert.Equal(t, "my-team", got.Name)
				assert.NotEmpty(t, got.ID)
			},
			wantErr: nil,
		},
		{
			name: "team with empty name",
			args: args{
				projectID: "proj_1",
				name:      "",
			},
			wantErr: domain.ErrTeamNameInvalid(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := domain.NewTeam(tt.args.projectID, tt.args.name)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			tt.check(t, got)
		})
	}
}