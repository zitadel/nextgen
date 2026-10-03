package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	api "github.com/zitadel/nextgen/api/generated"
)

// Action is what `clean` does, or would do, with one resource.
type Action string

const (
	// ActionDelete removes a user.
	ActionDelete Action = "delete"
	// ActionRevoke revokes a session.
	ActionRevoke Action = "revoke"
	// ActionGone marks a resource the target no longer has.
	ActionGone Action = "gone"
	// ActionRetain leaves a resource in place, with the reason.
	ActionRetain Action = "retain"
)

// PlanItem is one resource in a clean plan.
type PlanItem struct {
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Name   string `json:"name,omitempty"`
	Action Action `json:"action"`
	Reason string `json:"reason,omitempty"`
}

// CleanPlan is what `clean` found: every resource the manifest names, and what
// would happen to each. Building it only reads from the target.
type CleanPlan struct {
	Items []PlanItem `json:"items"`
}

// Count returns how many items carry action.
func (p CleanPlan) Count(action Action) int {
	n := 0
	for _, it := range p.Items {
		if it.Action == action {
			n++
		}
	}
	return n
}

// ClientFor builds a client for the manifest's target that plays no part in a
// measurement: plain net/http, the project's bearer, the preview origin.
func ClientFor(t Target) (*api.Client, error) {
	//egress:allow benchmark harness managing the server under test
	return api.NewClient(t.Base, NewCredentials(t.ProjectSecret), api.WithClient(originDoer{origin: t.Origin, client: &http.Client{Timeout: 30 * time.Second}}))
}

// PlanClean inspects the target and decides what to do with each resource the
// manifest names. A resource is only ever deleted when it is both in the
// manifest and named by the convention in full: the manifest alone is a file
// anyone can edit, and the convention alone would match lookalikes the
// harness never made.
func PlanClean(ctx context.Context, m Manifest) (CleanPlan, error) {
	c, err := ClientFor(m.Target)
	if err != nil {
		return CleanPlan{}, err
	}

	var plan CleanPlan
	for _, id := range m.Sessions {
		plan.Items = append(plan.Items, PlanItem{Kind: "session", ID: id, Action: ActionRevoke})
	}

	// The project is never deleted (the API has no such operation) but it is
	// checked: a manifest pointing at a project that is not ours must not be
	// followed to its users.
	res, err := c.GetProject(ctx, api.GetProjectParams{ProjectID: api.ProjectID(m.Project.ID)})
	if err != nil {
		return CleanPlan{}, fmt.Errorf("read project %s: %w", m.Project.ID, err)
	}
	switch p := res.(type) {
	case *api.ProjectResponse:
		if p.Name != m.Project.Name || !OwnsProjectName(p.Name) {
			return CleanPlan{}, fmt.Errorf("project %s is named %q, not the %q the manifest recorded, or does not follow the naming convention %s: refusing to touch it", m.Project.ID, p.Name, m.Project.Name, projectName)
		}
		plan.Items = append(plan.Items, PlanItem{Kind: "project", ID: p.ID, Name: p.Name, Action: ActionRetain,
			Reason: "the API has no delete-project operation; the next bootstrap reuses it"})
	case *api.GetProjectNotFound:
		// The target was reset: nothing under it exists any more.
		for _, u := range m.Users {
			plan.Items = append(plan.Items, PlanItem{Kind: "user", ID: u.ID, Name: u.Email, Action: ActionGone, Reason: "project not found"})
		}
		plan.Items = append(plan.Items, PlanItem{Kind: "project", ID: m.Project.ID, Name: m.Project.Name, Action: ActionGone})
		return plan, nil
	default:
		return CleanPlan{}, fmt.Errorf("read project %s: unexpected response %T", m.Project.ID, res)
	}

	users := make([]PlanItem, len(m.Users))
	err = forEach(ctx, len(m.Users), func(ctx context.Context, i int) error {
		u := m.Users[i]
		item := PlanItem{Kind: "user", ID: u.ID, Name: u.Email}
		res, err := c.GetUserByID(ctx, api.GetUserByIDParams{UserID: api.UserID(u.ID)})
		if err != nil {
			return fmt.Errorf("read user %s: %w", u.ID, err)
		}
		switch r := res.(type) {
		case *api.User:
			email := emailOf(r)
			switch {
			case email != u.Email:
				item.Action, item.Reason = ActionRetain, fmt.Sprintf("the user's address is %q, not the %q the manifest recorded", email, u.Email)
			case !OwnsEmail(email):
				item.Action, item.Reason = ActionRetain, "the address does not follow the naming convention"
			default:
				item.Action = ActionDelete
			}
		case *api.GetUserByIDNotFound:
			item.Action = ActionGone
		default:
			return fmt.Errorf("read user %s: unexpected response %T", u.ID, res)
		}
		users[i] = item
		return nil
	})
	if err != nil {
		return CleanPlan{}, err
	}
	plan.Items = append(plan.Items, users...)
	return plan, nil
}

func emailOf(u *api.User) string {
	raw, ok := u.Attributes["email"]
	if !ok {
		return ""
	}
	var email string
	if err := json.Unmarshal(raw, &email); err != nil {
		return ""
	}
	return email
}

// ApplyClean carries out the plan's revokes and deletes, then rewrites the
// manifest to what is left: removed and already-gone resources drop out, the
// project and anything retained stay. It returns the first failure with the
// manifest updated for what did succeed, so a retry picks up where it stopped.
func ApplyClean(ctx context.Context, manifestPath string, m Manifest, plan CleanPlan) (Manifest, error) {
	c, err := ClientFor(m.Target)
	if err != nil {
		return m, err
	}

	var (
		mu      sync.Mutex
		removed = map[string]bool{}
	)
	acting := make([]PlanItem, 0, len(plan.Items))
	for _, it := range plan.Items {
		if it.Action == ActionDelete || it.Action == ActionRevoke {
			acting = append(acting, it)
		}
		if it.Action == ActionGone {
			removed[it.Kind+"/"+it.ID] = true
		}
	}
	// Sessions go before the users they belong to; ids are independent, so
	// within a kind order does not matter.
	var sessions, users []PlanItem
	for _, it := range acting {
		if it.Kind == "session" {
			sessions = append(sessions, it)
		} else {
			users = append(users, it)
		}
	}
	run := func(items []PlanItem) error {
		return forEach(ctx, len(items), func(ctx context.Context, i int) error {
			it := items[i]
			var err error
			switch it.Kind {
			case "session":
				err = revokeSession(ctx, c, it.ID)
			default:
				err = deleteUser(ctx, c, it.ID)
			}
			if err != nil {
				return fmt.Errorf("%s %s: %w", it.Action, it.ID, err)
			}
			mu.Lock()
			removed[it.Kind+"/"+it.ID] = true
			mu.Unlock()
			return nil
		})
	}
	runErr := run(sessions)
	if runErr == nil {
		runErr = run(users)
	}

	var keepUsers []ManifestUser
	for _, u := range m.Users {
		if !removed["user/"+u.ID] {
			keepUsers = append(keepUsers, u)
		}
	}
	var keepSessions []string
	for _, s := range m.Sessions {
		if !removed["session/"+s] {
			keepSessions = append(keepSessions, s)
		}
	}
	m.Users, m.Sessions = keepUsers, keepSessions
	if err := SaveManifest(manifestPath, m); err != nil {
		return m, errors.Join(runErr, err)
	}
	return m, runErr
}

func deleteUser(ctx context.Context, c *api.Client, id string) error {
	res, err := c.DeleteUserByID(ctx, api.DeleteUserByIDParams{UserID: api.UserID(id)})
	if err != nil {
		return err
	}
	switch r := res.(type) {
	case *api.DeleteUserByIDNoContent, *api.DeleteUserByIDNotFound:
		return nil
	case *api.DeleteUserByIDUnauthorized:
		return fmt.Errorf("unauthorized: %s", r.Message)
	default:
		return fmt.Errorf("unexpected response %T", res)
	}
}

// revokeSession tolerates a refusal: a session that expired or went with its
// user is no longer ours to revoke, and the answer for that is a 401/403.
func revokeSession(ctx context.Context, c *api.Client, id string) error {
	res, err := c.RevokeSession(ctx, api.RevokeSessionParams{SessionID: api.SessionID(id)})
	if err != nil {
		return err
	}
	switch res.(type) {
	case *api.RevokeSessionNoContent, *api.RevokeSessionUnauthorized, *api.RevokeSessionForbidden:
		return nil
	default:
		return fmt.Errorf("unexpected response %T", res)
	}
}

// CountUsers pages through the users of the manifest's project and returns
// how many it holds, so `clean` can report what remains.
func CountUsers(ctx context.Context, m Manifest) (int, error) {
	c, err := ClientFor(m.Target)
	if err != nil {
		return 0, err
	}
	var (
		n     int
		token api.OptNilPageToken
	)
	for {
		res, err := c.QueryUsers(ctx, &api.QueryUsersRequest{Limit: api.NewOptLimit(100), PageToken: token},
			api.QueryUsersParams{ProjectID: api.NewOptProjectID(api.ProjectID(m.Project.ID))})
		if err != nil {
			return 0, err
		}
		page, ok := res.(*api.QueryUsersResponse)
		if !ok {
			return 0, fmt.Errorf("query users: unexpected response %T", res)
		}
		n += len(page.Users)
		next, ok := page.NextPageToken.Get()
		if !ok || next == "" {
			return n, nil
		}
		token = api.NewOptNilPageToken(next)
	}
}

// CountProjects pages through the projects the manifest's credential can
// list and returns how many there are.
func CountProjects(ctx context.Context, m Manifest) (int, error) {
	c, err := ClientFor(m.Target)
	if err != nil {
		return 0, err
	}
	var (
		n     int
		token api.OptNilPageToken
	)
	for {
		res, err := c.QueryProjects(ctx, &api.QueryProjectsRequest{Limit: api.NewOptLimit(100), PageToken: token})
		if err != nil {
			return 0, err
		}
		page, ok := res.(*api.QueryProjectsResponse)
		if !ok {
			return 0, fmt.Errorf("query projects: unexpected response %T", res)
		}
		n += len(page.Projects)
		next, ok := page.NextPageToken.Get()
		if !ok || next == "" {
			return n, nil
		}
		token = api.NewOptNilPageToken(next)
	}
}
