package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestNewProject(t *testing.T) {
	t.Parallel()
	type args struct {
		name           string
		previewOrigins []string
	}
	tests := []struct {
		name    string
		args    args
		check   func(t *testing.T, got *domain.Project)
		wantErr error
	}{
		{
			name: "project with name",
			args: args{
				name: "my-project",
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, "my-project", got.Name)
			},
			wantErr: nil,
		},
		{
			name: "project name is trimmed",
			args: args{
				name: "  my-project  ",
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, "my-project", got.Name)
			},
			wantErr: nil,
		},
		{
			name: "project with empty name",
			args: args{
				name: "",
			},
			wantErr: domain.ErrProjectNameInvalid(),
		},
		{
			name: "project with whitespace-only name",
			args: args{
				name: "   ",
			},
			wantErr: domain.ErrProjectNameInvalid(),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := domain.NewProject(tt.args.name, tt.args.previewOrigins)
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
