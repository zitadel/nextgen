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
	pw := domain.SetAuthFactorPassword(now)

	tests := []struct {
		name    string
		session domain.Session
		want    domain.SessionState
	}{
		{
			name:    "building session within ttl",
			session: domain.Session{ExpiresAt: now.Add(time.Hour)},
			want:    domain.SessionStateBuilding,
		},
		{
			name:    "unpersisted session with zero expiry is building",
			session: domain.Session{},
			want:    domain.SessionStateBuilding,
		},
		{
			name:    "abandoned building session past ttl is expired",
			session: domain.Session{ExpiresAt: now.Add(-time.Minute)},
			want:    domain.SessionStateExpired,
		},
		{
			name:    "active within ttl",
			session: domain.Session{Factors: []domain.AuthFactor{pw}, ExpiresAt: now.Add(time.Hour)},
			want:    domain.SessionStateActive,
		},
		{
			name:    "active past ttl is expired",
			session: domain.Session{Factors: []domain.AuthFactor{pw}, ExpiresAt: now.Add(-time.Hour)},
			want:    domain.SessionStateExpired,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, tt.session.State())
		})
	}
}
