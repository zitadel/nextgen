// Package harness is the Go side of the benchmark harness: the operations the
// scenarios drive through the generated client, the fixtures that provision a
// target, the sweep runner and the summariser. A running, healthy server is
// a prerequisite: whoever provisions a lane (Moon locally, a container or a
// cloud deployment elsewhere) starts it, and the harness is pointed at it.
// The k6 JavaScript module (k6module) and the `k6 x nextgen` subcommand tree
// (k6cmd) are thin layers over it.
package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"

	"github.com/ogen-go/ogen/ogenerrors"
	api "github.com/zitadel/zitadel/v5/api/generated"
)

// Target is a provisioned server and the one project and user the scenarios
// run against. Bootstrap writes it as a state file; the sweep hands it to each
// k6 run through the child process environment — never as -e, which would
// show the secret in process listings and expose it to scripts as __ENV —
// and the k6 module reads it back from its own process environment.
type Target struct {
	Base          string `json:"base"`
	Lane          string `json:"lane"`
	ProjectID     string `json:"project_id"`
	ProjectSecret string `json:"project_secret"`
	Origin        string `json:"origin"`
	UserID        string `json:"user_id"`
	Email         string `json:"email"`
	Password      string `json:"password"`
}

// Environment variable names carrying a Target into a k6 process. Prefixed so
// a scenario's own -e values cannot collide.
const (
	EnvBase          = "NEXTGEN_BASE"
	EnvLane          = "NEXTGEN_LANE"
	EnvProjectID     = "NEXTGEN_PROJECT_ID"
	EnvProjectSecret = "NEXTGEN_PROJECT_SECRET"
	EnvOrigin        = "NEXTGEN_ORIGIN"
	EnvUserID        = "NEXTGEN_USER_ID"
	EnvEmail         = "NEXTGEN_EMAIL"
	EnvPassword      = "NEXTGEN_PASSWORD"
)

// Env renders the target as KEY=value pairs for a child process environment.
func (t Target) Env() []string {
	return []string{
		EnvBase + "=" + t.Base,
		EnvLane + "=" + t.Lane,
		EnvProjectID + "=" + t.ProjectID,
		EnvProjectSecret + "=" + t.ProjectSecret,
		EnvOrigin + "=" + t.Origin,
		EnvUserID + "=" + t.UserID,
		EnvEmail + "=" + t.Email,
		EnvPassword + "=" + t.Password,
	}
}

// TargetFromEnv reads a Target back, reporting every missing variable at
// once so a misconfigured run fails with one message rather than one per
// attempt.
func TargetFromEnv(lookup func(string) (string, bool)) (Target, error) {
	get := func(key string) string {
		v, _ := lookup(key)
		return v
	}
	t := Target{
		Base:          get(EnvBase),
		Lane:          get(EnvLane),
		ProjectID:     get(EnvProjectID),
		ProjectSecret: get(EnvProjectSecret),
		Origin:        get(EnvOrigin),
		UserID:        get(EnvUserID),
		Email:         get(EnvEmail),
		Password:      get(EnvPassword),
	}
	if t.Lane == "" {
		t.Lane = "local"
	}
	var err error
	for _, kv := range [][2]string{
		{EnvBase, t.Base}, {EnvProjectID, t.ProjectID}, {EnvProjectSecret, t.ProjectSecret}, {EnvOrigin, t.Origin},
		{EnvUserID, t.UserID}, {EnvEmail, t.Email}, {EnvPassword, t.Password},
	} {
		if kv[1] == "" {
			err = errors.Join(err, fmt.Errorf("%s is not set", kv[0]))
		}
	}
	return t, err
}

// SaveTarget writes the state file. It holds the project secret, so it is
// owner-readable only — also when the file already exists with a wider mode,
// which os.WriteFile alone would keep.
func SaveTarget(path string, t Target) error {
	b, err := json.MarshalIndent(t, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if err := f.Chmod(0o600); err != nil {
		_ = f.Close()
		return err
	}
	if _, err := f.Write(append(b, '\n')); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// LoadTarget reads a state file written by SaveTarget.
func LoadTarget(path string) (Target, error) {
	var t Target
	b, err := os.ReadFile(path)
	if err != nil {
		return t, err
	}
	if err := json.Unmarshal(b, &t); err != nil {
		return t, fmt.Errorf("%s: %w", path, err)
	}
	return t, nil
}

// Credentials is the process-wide credential holder, shared by every VU, and
// the generated client's SecuritySource. Today it holds the project secret —
// the operator-plane bearer — and nothing rotates; the refreshing session
// cache is #1107's job and slots in here.
type Credentials struct {
	mu     sync.RWMutex
	bearer string
}

// NewCredentials returns a cache holding one bearer.
func NewCredentials(bearer string) *Credentials {
	return &Credentials{bearer: bearer}
}

// Bearer returns the current operator bearer.
func (c *Credentials) Bearer() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.bearer
}

// SetBearer replaces the operator bearer.
func (c *Credentials) SetBearer(bearer string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bearer = bearer
}

// OAuth2 implements api.SecuritySource.
func (c *Credentials) OAuth2(context.Context, api.OperationName) (api.OAuth2, error) {
	return api.OAuth2{Token: c.Bearer()}, nil
}

// NextgenSession implements api.SecuritySource. No session cookie is held;
// skipping lets the client fall through to the bearer on operations that
// accept either.
func (c *Credentials) NextgenSession(context.Context, api.OperationName) (api.NextgenSession, error) {
	return api.NextgenSession{}, ogenerrors.ErrSkipClientSecurity
}

var _ api.SecuritySource = (*Credentials)(nil)
