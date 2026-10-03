package harness

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"

	"github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
)

// Fixture declares what a benchmark target needs: one project, one user with
// a password, and optionally a population of further users. It is a JSON file
// so a lane's fixtures are data, reviewed and diffed like data; applying it is
// Bootstrap's job.
type Fixture struct {
	Project    FixtureProject    `json:"project"`
	User       FixtureUser       `json:"user"`
	Population FixturePopulation `json:"population"`
}

// FixturePopulation asks for Count further users named by PopulationEmail,
// each with the primary user's password. Scenarios that need a spread of
// users (rather than one hot row) declare it here, so the population is data
// in the lane's fixture and not something a scenario creates for itself.
type FixturePopulation struct {
	Count int `json:"count"`
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
	// `clean` only removes what follows the naming convention, so a fixture
	// that does not could be provisioned but never cleaned up.
	if fx.Project.Name != "" && !OwnsProjectName(fx.Project.Name) {
		errs = errors.Join(errs, fmt.Errorf("project.name %q must match %s", fx.Project.Name, projectName))
	}
	if fx.User.Email != "" && !OwnsEmail(fx.User.Email) {
		errs = errors.Join(errs, fmt.Errorf("user.email %q must match %s", fx.User.Email, userEmail))
	}
	if fx.Population.Count < 0 {
		errs = errors.Join(errs, errors.New("population.count must not be negative"))
	}
	if errs != nil {
		return fx, fmt.Errorf("%s: %w", path, errs)
	}
	if fx.User.Schema == "" {
		fx.User.Schema = schemas.DefaultHumanUserSchemaURL(DefaultBuiltinSchemaBase)
	}
	return fx, nil
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
