package domain_test

import (
	"strings"
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
				assert.Empty(t, got.ID)
			},
			wantErr: nil,
		},
		{
			name: "stores the validated name",
			args: args{
				projectID: "proj_1",
				name:      "  my-team  ",
			},
			check: func(t *testing.T, got *domain.Team) {
				assert.Equal(t, "my-team", got.Name)
			},
			wantErr: nil,
		},
		{
			name: "invalid name is rejected",
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

func TestValidateTeamName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		given    string
		wantName string
		wantErr  error
	}{
		{
			name:     "returns the name",
			given:    "my-team",
			wantName: "my-team",
		},
		{
			name:     "returns the trimmed name",
			given:    "  my-team  ",
			wantName: "my-team",
		},
		{
			name:    "empty",
			given:   "",
			wantErr: domain.ErrTeamNameInvalid(),
		},
		{
			name:    "whitespace only",
			given:   "   ",
			wantErr: domain.ErrTeamNameInvalid(),
		},
		{
			name:     "at the length limit",
			given:    strings.Repeat("a", domain.TeamNameMaxLength),
			wantName: strings.Repeat("a", domain.TeamNameMaxLength),
		},
		{
			name:     "multi-byte at the length limit",
			given:    strings.Repeat("チ", domain.TeamNameMaxLength),
			wantName: strings.Repeat("チ", domain.TeamNameMaxLength),
		},
		{
			name:    "over the length limit",
			given:   strings.Repeat("a", domain.TeamNameMaxLength+1),
			wantErr: domain.ErrTeamNameInvalid(),
		},
		{
			name:     "trimmed before the length check",
			given:    "  " + strings.Repeat("a", domain.TeamNameMaxLength) + "  ",
			wantName: strings.Repeat("a", domain.TeamNameMaxLength),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := domain.ValidateTeamName(tt.given)
			if tt.wantErr != nil {
				assert.ErrorIs(t, err, tt.wantErr)
				assert.Empty(t, got)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantName, got)
		})
	}
}
