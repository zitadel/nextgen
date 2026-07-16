package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
)

func TestNewProject(t *testing.T) {
	t.Parallel()
	type args struct {
		name                string
		previewOrigins      []string
		setupTokenGenerator func(generator *domainmock.MockTokenGenerator)
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
				setupTokenGenerator: func(generator *domainmock.MockTokenGenerator) {
					generator.EXPECT().
						Generate(gomock.Any()).Return("proj_secret", nil).
						Times(2)
				},
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
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			ctrl := gomock.NewController(t)
			tokenGenerator := domainmock.NewMockTokenGenerator(ctrl)

			if tt.args.setupTokenGenerator != nil {
				tt.args.setupTokenGenerator(tokenGenerator)
			}

			got, err := domain.NewProject(tt.args.name, tt.args.previewOrigins, tokenGenerator)
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
