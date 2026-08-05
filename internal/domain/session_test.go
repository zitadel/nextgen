package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestSession_State(t *testing.T) {
	t.Parallel()

	now := time.Now()
	revoked := now.Add(-time.Minute)
	passwordFactor := domain.SetAuthFactorPassword(now)

	tests := []struct {
		name    string
		session domain.Session
		want    domain.SessionState
	}{
		{
			name:    "no factors is building",
			session: domain.Session{ExpiresAt: now.Add(time.Hour)},
			want:    domain.SessionStateBuilding,
		},
		{
			name:    "factors and unexpired is active",
			session: domain.Session{Factors: []domain.AuthFactor{passwordFactor}, ExpiresAt: now.Add(time.Hour)},
			want:    domain.SessionStateActive,
		},
		{
			name:    "factors and expired is expired",
			session: domain.Session{Factors: []domain.AuthFactor{passwordFactor}, ExpiresAt: now.Add(-time.Hour)},
			want:    domain.SessionStateExpired,
		},
		{
			name:    "revoked wins over active",
			session: domain.Session{Factors: []domain.AuthFactor{passwordFactor}, ExpiresAt: now.Add(time.Hour), RevokedAt: &revoked},
			want:    domain.SessionStateRevoked,
		},
		{
			name:    "revoked wins over expired",
			session: domain.Session{Factors: []domain.AuthFactor{passwordFactor}, ExpiresAt: now.Add(-time.Hour), RevokedAt: &revoked},
			want:    domain.SessionStateRevoked,
		},
		{
			name:    "revoked wins over building",
			session: domain.Session{ExpiresAt: now.Add(time.Hour), RevokedAt: &revoked},
			want:    domain.SessionStateRevoked,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, tt.session.State())
		})
	}
}
