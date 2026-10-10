package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/api"
)

// region is a region of the cloud, as the home announces it to the console:
// an id, a name, and the base its API is called at, a path on the host
// ("/eu") or an absolute URL.
type region struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	APIBase string `json:"api_base"`
}

// parseRegions reads CLOUD_REGIONS, a JSON array of regions; empty when unset.
func parseRegions(raw string) ([]region, error) {
	if raw == "" {
		return nil, nil
	}
	var regions []region
	if err := json.Unmarshal([]byte(raw), &regions); err != nil {
		return nil, fmt.Errorf("CLOUD_REGIONS is not a JSON array of regions: %w", err)
	}
	for i, r := range regions {
		if r.ID == "" || r.Name == "" || r.APIBase == "" {
			return nil, fmt.Errorf("CLOUD_REGIONS[%d] needs id, name and api_base", i)
		}
	}
	return regions, nil
}

// sessionCookie is the home's session cookie, which the regions accept.
const sessionCookie = "__nextgen_session"

// bodyLimit bounds what is read from a region's answer.
const bodyLimit = 1 << 20

// regionClient calls the regions' APIs on behalf of the signed-in person.
type regionClient struct {
	regions []region
	host    string
	headers map[string]string
	client  *http.Client
}

func newRegionClient(regions []region, host string, headers map[string]string) *regionClient {
	return &regionClient{regions: regions, host: host, headers: headers, client: &http.Client{Timeout: 15 * time.Second}}
}

func (c *regionClient) find(id string) (region, bool) {
	for _, r := range c.regions {
		if r.ID == id {
			return r, true
		}
	}
	return region{}, false
}

// baseURL is where a region's API is called: its base as is when absolute,
// else on the deployment's host.
func (c *regionClient) baseURL(r region) string {
	if strings.HasPrefix(r.APIBase, "http://") || strings.HasPrefix(r.APIBase, "https://") {
		return r.APIBase
	}
	return "https://" + c.host + r.APIBase
}

// createdProject is what creating and claiming a project in a region yields.
type createdProject struct {
	ID        string
	Name      string
	TeamID    string
	CreatedAt time.Time
}

// regionError is a region's refusal, passed on with its status.
type regionError struct {
	Status  int
	Code    string
	Message string
}

func (e *regionError) Error() string {
	return fmt.Sprintf("region answered %d %s: %s", e.Status, e.Code, e.Message)
}

// createProject creates a project in a region and claims it for the person
// whose session cookie this is: the public create, which answers the project
// secret once; claim/init with that secret; claim/complete with the cookie
// and its CSRF token, which the region derives from the same cookie. The
// secret is used for the challenge and never kept.
func (c *regionClient) createProject(ctx context.Context, r region, name, cookie string) (createdProject, error) {
	base := c.baseURL(r)
	var created struct {
		ID            string    `json:"id"`
		Name          string    `json:"name"`
		ProjectSecret string    `json:"project_secret"`
		CreatedAt     time.Time `json:"created_at"`
	}
	if err := c.do(ctx, base+"/projects", map[string]any{"name": name, "preview_origins": []string{}, "seed_defaults": true}, nil, http.StatusCreated, &created); err != nil {
		return createdProject{}, fmt.Errorf("create: %w", err)
	}
	var challenge struct {
		ChallengeID string `json:"challenge_id"`
	}
	if err := c.do(ctx, base+"/projects/"+created.ID+"/claim/init", map[string]any{},
		map[string]string{"Authorization": "Bearer " + created.ProjectSecret}, http.StatusCreated, &challenge); err != nil {
		return createdProject{}, fmt.Errorf("claim/init: %w", err)
	}
	var claimed struct {
		TeamID string `json:"team_id"`
	}
	if err := c.do(ctx, base+"/projects/"+created.ID+"/claim/complete", map[string]any{"challenge_id": challenge.ChallengeID},
		map[string]string{"Cookie": sessionCookie + "=" + cookie, api.CSRFHeader: api.CSRFToken(cookie)}, http.StatusOK, &claimed); err != nil {
		return createdProject{}, fmt.Errorf("claim/complete: %w", err)
	}
	return createdProject{ID: created.ID, Name: created.Name, TeamID: claimed.TeamID, CreatedAt: created.CreatedAt}, nil
}

// do posts body as JSON and decodes the answer into out when the status is
// the expected one; any other status is a regionError.
func (c *regionClient) do(ctx context.Context, url string, body any, headers map[string]string, want int, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	for name, value := range c.headers {
		req.Header.Set(name, value)
	}
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, bodyLimit))
	if err != nil {
		return err
	}
	if resp.StatusCode != want {
		refusal := &regionError{Status: resp.StatusCode}
		var parsed struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.Unmarshal(data, &parsed) == nil {
			refusal.Code, refusal.Message = parsed.Code, parsed.Message
		}
		if refusal.Message == "" {
			refusal.Message = strings.TrimSpace(string(data))
		}
		return refusal
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return errors.New("region answered something that is not JSON")
	}
	return nil
}
