package api_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"

	"github.com/ogen-go/ogen/ogenerrors"

	"go.zitadel.com/zitadel/v5/api"
)

// projectSecret authenticates every request with a project secret, the
// bearer token the API's pat scheme takes. The other schemes are skipped:
// oauth2 is a person's access token, and the session cookie is for a browser
// signed in through the login.
type projectSecret string

func (s projectSecret) Pat(context.Context, api.OperationName) (api.Pat, error) {
	return api.Pat{Token: string(s)}, nil
}

func (projectSecret) OAuth2(context.Context, api.OperationName) (api.OAuth2, error) {
	return api.OAuth2{}, ogenerrors.ErrSkipClientSecurity
}

func (projectSecret) SessionCookie(context.Context, api.OperationName) (api.SessionCookie, error) {
	return api.SessionCookie{}, ogenerrors.ErrSkipClientSecurity
}

// The README's example: a client on a deployment's origin, authenticated
// with a project secret, reading one project. The deployment here is a test
// server answering that one operation, so the example runs offline.
func ExampleNew() {
	deployment := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":"proj_123","name":"Example project","origins":[],`+
			`"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z","owning_team_id":"team_1"}`)
	}))
	defer deployment.Close()

	client, err := api.New(deployment.URL, projectSecret("zps_…"))
	if err != nil {
		panic(err)
	}
	res, err := client.GetProject(context.Background(), api.GetProjectParams{ProjectID: "proj_123"})
	if err != nil {
		panic(err)
	}
	project, ok := res.(*api.ProjectDetailResponse)
	if !ok {
		panic(fmt.Sprintf("not a project: %T", res))
	}
	fmt.Println(project.Name)
	// Output: Example project
}
