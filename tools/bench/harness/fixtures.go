package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/go-faster/jx"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
)

// Fixture declares what a benchmark target needs: one project and one user
// with a password. It is a JSON file so a lane's fixtures are data, reviewed
// and diffed like data; applying it is Bootstrap's job.
type Fixture struct {
	Project FixtureProject `json:"project"`
	User    FixtureUser    `json:"user"`
}

// FixtureProject is the project to create. The first preview origin is the
// Origin header the flow requests carry.
type FixtureProject struct {
	Name           string   `json:"name"`
	PreviewOrigins []string `json:"preview_origins"`
	SeedDefaults   bool     `json:"seed_defaults"`
}

// FixtureUser is the user to create. Schema defaults to the server's built-in
// human user schema, which seed_defaults installs.
type FixtureUser struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Schema   string `json:"schema,omitempty"`
}

// DefaultBuiltinSchemaBase mirrors the server's schema.builtin_public_base
// default; a lane running a server with another base sets user.schema.
const DefaultBuiltinSchemaBase = "https://nextgen.com/api/schemas"

// LoadFixture reads and validates a fixture file.
func LoadFixture(path string) (Fixture, error) {
	var fx Fixture
	b, err := os.ReadFile(path)
	if err != nil {
		return fx, err
	}
	if err := json.Unmarshal(b, &fx); err != nil {
		return fx, fmt.Errorf("%s: %w", path, err)
	}
	var errs error
	if fx.Project.Name == "" {
		errs = errors.Join(errs, errors.New("project.name is required"))
	}
	if len(fx.Project.PreviewOrigins) == 0 {
		errs = errors.Join(errs, errors.New("project.preview_origins needs at least one origin: the flow requests send it"))
	}
	if fx.User.Email == "" || fx.User.Password == "" {
		errs = errors.Join(errs, errors.New("user.email and user.password are required"))
	}
	if errs != nil {
		return fx, fmt.Errorf("%s: %w", path, errs)
	}
	if fx.User.Schema == "" {
		fx.User.Schema = schemas.DefaultHumanUserSchemaURL(DefaultBuiltinSchemaBase)
	}
	return fx, nil
}

// Bootstrap applies a fixture to a running server through the generated
// client — POST /projects mints the operator bearer, then the user and its
// password — and proves the result by walking one login journey and one user
// read before returning the target. A fixture that cannot be driven is
// reported here, not as a wall of failed iterations later.
func Bootstrap(ctx context.Context, base, lane string, fx Fixture) (Target, error) {
	creds := NewCredentials("")
	//egress:allow benchmark harness provisioning the server under test
	c, err := api.NewClient(base, creds, api.WithClient(originDoer{origin: fx.Project.PreviewOrigins[0], client: &http.Client{Timeout: 30 * time.Second}}))
	if err != nil {
		return Target{}, err
	}

	created, err := c.CreateProject(ctx, &api.CreateProjectRequest{
		Name:           fx.Project.Name,
		PreviewOrigins: fx.Project.PreviewOrigins,
		SeedDefaults:   api.NewOptBool(fx.Project.SeedDefaults),
	})
	if err != nil {
		return Target{}, fmt.Errorf("create project: %w", err)
	}
	project, ok := created.(*api.CreateProjectResponse)
	if !ok {
		return Target{}, fmt.Errorf("create project: unexpected response %T", created)
	}
	creds.SetBearer(project.ProjectSecret)

	email, err := json.Marshal(fx.User.Email)
	if err != nil {
		return Target{}, err
	}
	userRes, err := c.CreateUser(ctx, &api.CreateUserRequest{
		Schema:     fx.User.Schema,
		Attributes: api.CreateUserRequestAttributes{"email": jx.Raw(email)},
	}, api.CreateUserParams{ProjectID: api.ProjectID(project.ID)})
	if err != nil {
		return Target{}, fmt.Errorf("create user: %w", err)
	}
	user, ok := userRes.(*api.User)
	if !ok {
		return Target{}, fmt.Errorf("create user: unexpected response %T", userRes)
	}

	pwRes, err := c.SetUserPassword(ctx, &api.SetUserPasswordRequest{Password: fx.User.Password}, api.SetUserPasswordParams{UserID: user.ID})
	if err != nil {
		return Target{}, fmt.Errorf("set password: %w", err)
	}
	if _, ok := pwRes.(*api.SetUserPasswordNoContent); !ok {
		return Target{}, fmt.Errorf("set password: unexpected response %T", pwRes)
	}

	t := Target{
		Base:          base,
		Lane:          lane,
		ProjectID:     project.ID,
		ProjectSecret: project.ProjectSecret,
		Origin:        fx.Project.PreviewOrigins[0],
		UserID:        string(user.ID),
		Email:         fx.User.Email,
		Password:      fx.User.Password,
	}
	if _, err := Login(ctx, c, t); err != nil {
		return Target{}, fmt.Errorf("proving the login journey: %w", err)
	}
	if _, err := GetUser(ctx, c, t); err != nil {
		return Target{}, fmt.Errorf("proving the user read: %w", err)
	}
	return t, nil
}

// originDoer is the plain transport Bootstrap uses: outside k6 there is no
// VU state to delegate to, and nothing here is measured.
type originDoer struct {
	origin string
	client *http.Client
}

func (d originDoer) Do(r *http.Request) (*http.Response, error) {
	r.Header.Set("Origin", d.origin)
	return d.client.Do(r)
}
