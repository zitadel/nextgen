package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/go-faster/jx"
	api "github.com/zitadel/nextgen/api/generated"
)

// BootstrapOptions says what to provision, where, and where the manifest
// lives.
type BootstrapOptions struct {
	Base string
	Lane string
	// Fixture is what the target should end up holding.
	Fixture Fixture
	// ManifestPath is read first and written as provisioning progresses. A
	// manifest already there makes bootstrap idempotent: what it names and the
	// target still has is kept, only what is missing is created.
	ManifestPath string
	Log          io.Writer
}

// Bootstrap applies a fixture to a running server through the generated
// client — POST /projects mints the operator bearer, then the users and their
// passwords — records every resource in the manifest as it goes, and proves
// the result by walking one login journey and one user read before returning.
// A fixture that cannot be driven is reported here, not as a wall of failed
// iterations later.
//
// Against an existing manifest it reconciles rather than repeats: the project
// is reused, users the target still has are kept, and only missing ones are
// created. A manifest recorded for another target, or whose project the target
// no longer knows, is an error naming the file to remove — guessing would
// leave resources behind that nothing tracks.
//
// The manifest is written after the project exists and again after the users,
// so a bootstrap that fails midway leaves a manifest `clean` can act on.
func Bootstrap(ctx context.Context, o BootstrapOptions) (Manifest, error) {
	fx := o.Fixture
	lock, err := AcquireRunLock(o.ManifestPath, "bootstrap")
	if err != nil {
		return Manifest{}, err
	}
	defer func() { _ = lock.Release() }()

	logf := func(format string, args ...any) {
		if o.Log != nil {
			fmt.Fprintf(o.Log, format+"\n", args...)
		}
	}

	m, err := LoadManifestIfPresent(o.ManifestPath)
	if err != nil {
		return Manifest{}, err
	}
	creds := NewCredentials("")
	//egress:allow benchmark harness provisioning the server under test
	c, err := api.NewClient(o.Base, creds, api.WithClient(originDoer{origin: fx.Project.PreviewOrigins[0], client: &http.Client{Timeout: 30 * time.Second}}))
	if err != nil {
		return Manifest{}, err
	}

	if m == nil {
		m = &Manifest{}
		created, err := c.CreateProject(ctx, &api.CreateProjectRequest{
			Name:           fx.Project.Name,
			PreviewOrigins: fx.Project.PreviewOrigins,
			SeedDefaults:   api.NewOptBool(fx.Project.SeedDefaults),
		})
		if err != nil {
			return Manifest{}, fmt.Errorf("create project: %w", err)
		}
		project, ok := created.(*api.CreateProjectResponse)
		if !ok {
			return Manifest{}, fmt.Errorf("create project: unexpected response %T", created)
		}
		m.Project = ManifestProject{ID: project.ID, Name: fx.Project.Name}
		m.Target.ProjectSecret = project.ProjectSecret
		creds.SetBearer(project.ProjectSecret)
		logf("created project %s", project.ID)
	} else {
		if m.Target.Base != o.Base {
			return Manifest{}, fmt.Errorf("%s was written for %s, not %s: it describes another target; remove it or point --manifest elsewhere", o.ManifestPath, m.Target.Base, o.Base)
		}
		if m.Project.Name != fx.Project.Name {
			return Manifest{}, fmt.Errorf("%s holds project %q but the fixture declares %q: run `clean --confirm` and remove the manifest to start over", o.ManifestPath, m.Project.Name, fx.Project.Name)
		}
		creds.SetBearer(m.Target.ProjectSecret)
		res, err := c.GetProject(ctx, api.GetProjectParams{ProjectID: api.ProjectID(m.Project.ID)})
		if err != nil {
			return Manifest{}, fmt.Errorf("check project %s: %w", m.Project.ID, err)
		}
		if _, ok := res.(*api.ProjectResponse); !ok {
			return Manifest{}, fmt.Errorf("the manifest's project %s is not on %s (%T): the target was reset or the manifest is stale; remove %s", m.Project.ID, o.Base, res, o.ManifestPath)
		}
		logf("reusing project %s", m.Project.ID)
	}
	m.Target.Base = o.Base
	m.Target.Lane = o.Lane
	m.Target.ProjectID = m.Project.ID
	m.Target.Origin = fx.Project.PreviewOrigins[0]
	m.Target.Email = fx.User.Email
	m.Target.Password = fx.User.Password
	if err := SaveManifest(o.ManifestPath, *m); err != nil {
		return *m, err
	}

	// The users the fixture wants, the primary one first.
	want := make([]string, 0, 1+fx.Population.Count)
	want = append(want, fx.User.Email)
	for n := 1; n <= fx.Population.Count; n++ {
		want = append(want, PopulationEmail(n))
	}

	// Keep the manifest users the target still has; the rest are recreated.
	kept, err := keepExisting(ctx, c, *m, want)
	if err != nil {
		return *m, err
	}
	m.Users = kept
	var missing []string
	for _, email := range want {
		if _, ok := m.userByEmail(email); !ok {
			missing = append(missing, email)
		}
	}

	var mu sync.Mutex
	createErr := forEach(ctx, len(missing), func(ctx context.Context, i int) error {
		email := missing[i]
		id, err := createUserWithPassword(ctx, c, m.Project.ID, fx.User.Schema, email, fx.User.Password)
		if err != nil {
			return fmt.Errorf("user %s: %w", email, err)
		}
		mu.Lock()
		m.Users = append(m.Users, ManifestUser{ID: id, Email: email, Primary: email == fx.User.Email})
		mu.Unlock()
		return nil
	})
	// Record what was created even when some of it failed.
	orderUsers(m, want)
	if err := SaveManifest(o.ManifestPath, *m); err != nil {
		return *m, errors.Join(createErr, err)
	}
	if createErr != nil {
		return *m, createErr
	}
	logf("users: %d kept, %d created", len(m.Users)-len(missing), len(missing))

	// Nothing changed and the target still answers the bearer: the manifest
	// already describes a proven target.
	if len(missing) == 0 && len(m.Sessions) > 0 {
		return *m, nil
	}

	primary := primaryOf(*m)
	t := m.Target
	t.UserID = primary.ID
	m.Target.UserID = primary.ID
	login, err := Login(ctx, c, t)
	if err != nil {
		return *m, fmt.Errorf("proving the login journey: %w", err)
	}
	if login.SessionID != "" {
		m.Sessions = append(m.Sessions, login.SessionID)
	}
	if _, err := GetUser(ctx, c, t); err != nil {
		_ = SaveManifest(o.ManifestPath, *m)
		return *m, fmt.Errorf("proving the user read: %w", err)
	}
	return *m, SaveManifest(o.ManifestPath, *m)
}

// keepExisting returns the manifest users that are still on the target and
// still wanted. A user the target answers 404 for is dropped so it is
// recreated; any other failure aborts, because treating it as "missing" would
// create a duplicate.
func keepExisting(ctx context.Context, c *api.Client, m Manifest, want []string) ([]ManifestUser, error) {
	wanted := make(map[string]bool, len(want))
	for _, e := range want {
		wanted[e] = true
	}
	var candidates []ManifestUser
	for _, u := range m.Users {
		if wanted[u.Email] {
			candidates = append(candidates, u)
		}
	}
	present := make([]bool, len(candidates))
	err := forEach(ctx, len(candidates), func(ctx context.Context, i int) error {
		res, err := c.GetUserByID(ctx, api.GetUserByIDParams{UserID: api.UserID(candidates[i].ID)})
		if err != nil {
			return fmt.Errorf("check user %s: %w", candidates[i].ID, err)
		}
		switch res.(type) {
		case *api.User:
			present[i] = true
		case *api.GetUserByIDNotFound:
		default:
			return fmt.Errorf("check user %s: unexpected response %T", candidates[i].ID, res)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	var kept []ManifestUser
	for i, u := range candidates {
		if present[i] {
			kept = append(kept, u)
		}
	}
	return kept, nil
}

// orderUsers puts the manifest users in fixture order, so the file is stable
// across runs whatever order the pool finished in.
func orderUsers(m *Manifest, want []string) {
	index := make(map[string]int, len(want))
	for i, e := range want {
		index[e] = i
	}
	sortUsers(m.Users, index)
}

func primaryOf(m Manifest) ManifestUser {
	for _, u := range m.Users {
		if u.Primary {
			return u
		}
	}
	return ManifestUser{}
}

func createUserWithPassword(ctx context.Context, c *api.Client, projectID, schema, email, password string) (string, error) {
	rawEmail, err := json.Marshal(email)
	if err != nil {
		return "", err
	}
	userRes, err := c.CreateUser(ctx, &api.CreateUserRequest{
		Schema:     schema,
		Attributes: api.CreateUserRequestAttributes{"email": jx.Raw(rawEmail)},
	}, api.CreateUserParams{ProjectID: api.ProjectID(projectID)})
	if err != nil {
		return "", fmt.Errorf("create user: %w", err)
	}
	user, ok := userRes.(*api.User)
	if !ok {
		return "", fmt.Errorf("create user: unexpected response %T", userRes)
	}
	pwRes, err := c.SetUserPassword(ctx, &api.SetUserPasswordRequest{Password: password}, api.SetUserPasswordParams{UserID: user.ID})
	if err != nil {
		return "", fmt.Errorf("set password: %w", err)
	}
	if _, ok := pwRes.(*api.SetUserPasswordNoContent); !ok {
		return "", fmt.Errorf("set password: unexpected response %T", pwRes)
	}
	return string(user.ID), nil
}
