package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestUserAgent_Clone(t *testing.T) {
	t.Parallel()

	// Nil-safe: a nil UserAgent clones to nil, preserving the "no user agent" signal.
	var none *domain.UserAgent
	assert.Nil(t, none.Clone())

	orig := &domain.UserAgent{ID: "fp", IP: "1.2.3.4", Info: map[string]any{"k": "v"}}
	clone := orig.Clone()
	assert.Equal(t, orig, clone)

	clone.Info["k"] = "changed"
	clone.Info["extra"] = "x"
	assert.Equal(t, "v", orig.Info["k"], "clone's Info map must be independent of the original")
	assert.NotContains(t, orig.Info, "extra")
}

func TestNewSession_ClonesUserAgent(t *testing.T) {
	t.Parallel()

	callerInfo := map[string]any{"user_agent": "agent/1"}
	agent := &domain.UserAgent{IP: "203.0.113.9", Info: callerInfo}

	sess, err := domain.NewSession("proj_1", agent)
	require.NoError(t, err)
	require.NotNil(t, sess.UserAgent)
	assert.Equal(t, "203.0.113.9", sess.UserAgent.IP)

	// The session owns its Info map: simulate the storage insert mutating it in
	// place (it adds ip/fingerprint keys) and confirm nothing leaks back to the
	// caller's request-scoped UserAgent.
	sess.UserAgent.Info["ip"] = "203.0.113.9"
	sess.UserAgent.Info["fingerprint"] = ""
	assert.NotContains(t, callerInfo, "ip", "caller's Info map must not be mutated on persist")
	assert.NotContains(t, callerInfo, "fingerprint")
}
