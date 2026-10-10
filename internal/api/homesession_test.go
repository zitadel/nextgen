package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// fakeHome is an identity home that vouches for exactly one cookie.
type fakeHome struct {
	*httptest.Server
	cookie     string
	header     [2]string
	sessionHit atomic.Int32
}

func newFakeHome(t *testing.T, cookie string, header [2]string) *fakeHome {
	t.Helper()
	home := &fakeHome{cookie: cookie, header: header}
	home.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		c, err := r.Cookie(homeSessionCookie)
		if err != nil || c.Value != home.cookie || (home.header[0] != "" && r.Header.Get(home.header[0]) != home.header[1]) {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": "auth.unauthorized"})
			return
		}
		switch r.URL.Path {
		case "/sessions/me":
			home.sessionHit.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"session_id": "sess_home", "project_id": "proj_platform", "state": "active", "user_id": "user_home",
				"user":       map[string]string{"user_id": "user_home", "identifier": "ada@example.com", "identifier_property": "email", "display": "Ada"},
				"expires_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
			})
		case "/users/me":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": "user_home", "schema": "https://schemas.example/human.json",
				"attributes": map[string]any{"email": "ada@example.com"},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(home.Close)
	return home
}

type fakeHomeUsers struct {
	existing map[string]bool
	created  []service.CreateUserInput
}

func (f *fakeHomeUsers) GetUserByID(_ context.Context, input service.GetUserInput) (*domain.User, error) {
	if f.existing[input.UserID] {
		return &domain.User{ProjectID: input.ProjectID, ID: input.UserID}, nil
	}
	return nil, domain.ErrUserNotFound()
}

func (f *fakeHomeUsers) CreateUser(_ context.Context, input service.CreateUserInput) (*domain.User, error) {
	f.created = append(f.created, input)
	if f.existing == nil {
		f.existing = map[string]bool{}
	}
	f.existing[input.ID] = true
	return &domain.User{ProjectID: input.ProjectID, ID: input.ID, SchemaURL: input.SchemaURL}, nil
}

type fakeTeams struct{ ensured []string }

func (f *fakeTeams) EnsurePersonalTeam(_ context.Context, projectID, userID string) error {
	f.ensured = append(f.ensured, projectID+"/"+userID)
	return nil
}

func TestHomeSessionResolver(t *testing.T) {
	t.Parallel()

	t.Run("a cookie the home vouches for becomes a session here and provisions the user once", func(t *testing.T) {
		t.Parallel()
		home := newFakeHome(t, "home-cookie", [2]string{"x-bypass", "secret"})
		users, teams := &fakeHomeUsers{}, &fakeTeams{}
		r, err := NewHomeSessionResolver(HomeConfig{URL: home.URL + "/", Headers: map[string]string{"x-bypass": "secret"}}, "proj_platform", users, teams)
		require.NoError(t, err)

		token, session, err := r.Resolve(t.Context(), "home-cookie")
		require.NoError(t, err)
		assert.Equal(t, "proj_platform", token.ProjectID, "the session is one of this server's platform project")
		assert.Equal(t, "user_home", token.UserID, "under the home's user id")
		assert.Equal(t, domain.TokenTypeSessionToken, token.Type)
		require.NotNil(t, token.SessionID)
		assert.Equal(t, "sess_home", *token.SessionID)
		assert.NoError(t, domain.ValidateSessionToken(token))
		assert.Equal(t, domain.SessionStateActive, session.State())
		assert.Equal(t, "sess_home", session.ID)
		require.NotNil(t, session.User)
		assert.Equal(t, "ada@example.com", session.User.Identifier)

		require.Len(t, users.created, 1)
		assert.Equal(t, service.CreateUserInput{
			ProjectID:  "proj_platform",
			SchemaURL:  "https://schemas.example/human.json",
			Attributes: map[string]any{"email": "ada@example.com"},
			ID:         "user_home",
		}, users.created[0])
		assert.Equal(t, []string{"proj_platform/user_home"}, teams.ensured)

		again, _, err := r.Resolve(t.Context(), "home-cookie")
		require.NoError(t, err)
		assert.Equal(t, token.UserID, again.UserID)
		assert.Equal(t, int32(1), home.sessionHit.Load(), "the second resolution is served from the cache")
		assert.Len(t, users.created, 1, "and provisions nothing again")
	})

	t.Run("an existing shadow is not created again, its team is ensured", func(t *testing.T) {
		t.Parallel()
		home := newFakeHome(t, "home-cookie", [2]string{})
		users, teams := &fakeHomeUsers{existing: map[string]bool{"user_home": true}}, &fakeTeams{}
		r, err := NewHomeSessionResolver(HomeConfig{URL: home.URL}, "proj_platform", users, teams)
		require.NoError(t, err)
		_, _, err = r.Resolve(t.Context(), "home-cookie")
		require.NoError(t, err)
		assert.Empty(t, users.created)
		assert.Equal(t, []string{"proj_platform/user_home"}, teams.ensured)
	})

	t.Run("a cookie the home refuses is an invalid session token", func(t *testing.T) {
		t.Parallel()
		home := newFakeHome(t, "home-cookie", [2]string{})
		r, err := NewHomeSessionResolver(HomeConfig{URL: home.URL}, "proj_platform", &fakeHomeUsers{}, nil)
		require.NoError(t, err)
		for _, cookie := range []string{"", "other-cookie"} {
			_, _, err := r.Resolve(t.Context(), cookie)
			assert.True(t, errors.Is(err, domain.ErrSessionTokenInvalid()), "%q: %v", cookie, err)
		}
	})

	t.Run("the cache honours its lifetime", func(t *testing.T) {
		t.Parallel()
		home := newFakeHome(t, "home-cookie", [2]string{})
		r, err := NewHomeSessionResolver(HomeConfig{URL: home.URL, CacheTTL: time.Minute}, "proj_platform", &fakeHomeUsers{}, nil)
		require.NoError(t, err)
		now := time.Now()
		r.now = func() time.Time { return now }
		_, _, err = r.Resolve(t.Context(), "home-cookie")
		require.NoError(t, err)
		now = now.Add(2 * time.Minute)
		_, _, err = r.Resolve(t.Context(), "home-cookie")
		require.NoError(t, err)
		assert.Equal(t, int32(2), home.sessionHit.Load())
	})

	t.Run("configuration", func(t *testing.T) {
		t.Parallel()
		_, err := NewHomeSessionResolver(HomeConfig{URL: "home.example"}, "proj_platform", &fakeHomeUsers{}, nil)
		assert.ErrorContains(t, err, "absolute http(s) URL")
		_, err = NewHomeSessionResolver(HomeConfig{URL: "https://home.example"}, "", &fakeHomeUsers{}, nil)
		assert.ErrorContains(t, err, "platform project")
		assert.NoError(t, HomeConfig{}.Validate(), "no home is fine")
	})
}
