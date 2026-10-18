package cell

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type PeerClient struct {
	HTTP *http.Client
}

func NewPeerClient() *PeerClient {
	// Longer timeout so Phase 5 delay-slider demos (per-hop sleep) do not abort mid-chain.
	return &PeerClient{HTTP: &http.Client{Timeout: 60 * time.Second}}
}

type MeResponse struct {
	URL       string `json:"url"`
	Label     string `json:"label"`
	IsParent  bool   `json:"is_parent"`
	ParentURL string `json:"parent_url"`
	Status    string `json:"status"`
}

func (c *PeerClient) GetMe(ctx context.Context, baseURL string) (MeResponse, error) {
	var out MeResponse
	err := c.doJSON(ctx, http.MethodGet, NormalizeURL(baseURL)+"/v1/me", nil, "", &out)
	return out, err
}

type PrepareResponse struct {
	JoinToken string    `json:"join_token"`
	ParentURL string    `json:"parent_url"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (c *PeerClient) Prepare(ctx context.Context, parentURL string) (PrepareResponse, error) {
	var out PrepareResponse
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(parentURL)+"/v1/join/prepare", map[string]any{}, "", &out)
	return out, err
}

type AcceptRequest struct {
	ParentURL string `json:"parent_url"`
	JoinToken string `json:"join_token"`
}

type AcceptResponse struct {
	OK        bool   `json:"ok"`
	ParentURL string `json:"parent_url"`
}

func (c *PeerClient) Accept(ctx context.Context, childURL string, req AcceptRequest) (AcceptResponse, error) {
	var out AcceptResponse
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(childURL)+"/v1/join/accept", req, "", &out)
	return out, err
}

type CompleteRequest struct {
	ChildURL  string `json:"child_url"`
	JoinToken string `json:"join_token"`
}

type CompleteResponse struct {
	OK         bool   `json:"ok"`
	JoinSecret string `json:"join_secret"`
	ParentURL  string `json:"parent_url"`
}

func (c *PeerClient) Complete(ctx context.Context, parentURL string, req CompleteRequest) (CompleteResponse, error) {
	var out CompleteResponse
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(parentURL)+"/v1/join/complete", req, "", &out)
	return out, err
}

func (c *PeerClient) Heartbeat(ctx context.Context, parentURL, joinSecret string) error {
	return c.doJSON(ctx, http.MethodPost, NormalizeURL(parentURL)+"/v1/heartbeat", map[string]any{}, joinSecret, nil)
}

type ProjectResponse struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	IsParent        bool   `json:"is_parent"`
	LookupEnabled   bool   `json:"lookup_enabled"`
	ParentProjectID string `json:"parent_project_id"`
	ParentCellURL   string `json:"parent_cell_url"`
	HostCellURL     string `json:"host_cell_url"`
	CreatedAt       string `json:"created_at"`
}

func (c *PeerClient) ListProjects(ctx context.Context, cellURL string) ([]ProjectResponse, error) {
	var out struct {
		Projects []ProjectResponse `json:"projects"`
	}
	err := c.doJSON(ctx, http.MethodGet, NormalizeURL(cellURL)+"/v1/projects", nil, "", &out)
	return out.Projects, err
}

func (c *PeerClient) CreateProject(ctx context.Context, cellURL string, body map[string]any) (ProjectResponse, error) {
	var out ProjectResponse
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/projects", body, "", &out)
	return out, err
}

func (c *PeerClient) GetProject(ctx context.Context, cellURL, projectID string) (ProjectResponse, error) {
	var out struct {
		Project ProjectResponse `json:"project"`
	}
	err := c.doJSON(ctx, http.MethodGet, NormalizeURL(cellURL)+"/v1/projects/"+projectID, nil, "", &out)
	return out.Project, err
}

func (c *PeerClient) AttachProject(ctx context.Context, cellURL, projectID string, parentProjectID, parentCellURL string) error {
	return c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/attach", map[string]any{
		"parent_project_id": parentProjectID,
		"parent_cell_url":   parentCellURL,
	}, "", nil)
}

type CreateUserResponse struct {
	User struct {
		ID        string `json:"id"`
		ProjectID string `json:"project_id"`
		Email     string `json:"email"`
		CreatedAt string `json:"created_at"`
	} `json:"user"`
	Trace []TraceHop `json:"trace"`
	Error string     `json:"error"`
}

func (c *PeerClient) CreateUser(ctx context.Context, cellURL, projectID, email string, deferFloat bool) (CreateUserResponse, error) {
	var out CreateUserResponse
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/users", map[string]any{
		"email":       email,
		"defer_float": deferFloat,
	}, "", &out)
	return out, err
}

func (c *PeerClient) FloatUser(ctx context.Context, cellURL, projectID, key string) ([]TraceHop, error) {
	var out struct {
		OK    bool       `json:"ok"`
		Trace []TraceHop `json:"trace"`
		Error string     `json:"error"`
	}
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/float", map[string]any{
		"key": key,
	}, "", &out)
	return out.Trace, err
}

type PushLookupRequest struct {
	Key           string `json:"key"`
	HomeProjectID string `json:"home_project_id"`
	HomeCellURL   string `json:"home_cell_url"`
	ProjectID     string `json:"project_id,omitempty"`
}

func (c *PeerClient) PushLookup(ctx context.Context, cellURL string, req PushLookupRequest) error {
	return c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/lookup/push", req, "", nil)
}

type LookupResult struct {
	Hit              bool   `json:"hit"`
	HomeProjectID    string `json:"home_project_id"`
	HomeCellURL      string `json:"home_cell_url"`
	State            string `json:"state,omitempty"`
	FoundAtProjectID string `json:"found_at,omitempty"`
}

func (c *PeerClient) Lookup(ctx context.Context, cellURL, projectID, key string) (LookupResult, []TraceHop, error) {
	var out struct {
		Hit           bool       `json:"hit"`
		HomeProjectID string     `json:"home_project_id"`
		HomeCellURL   string     `json:"home_cell_url"`
		State         string     `json:"state"`
		Trace         []TraceHop `json:"trace"`
	}
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/lookup", map[string]any{
		"project_id": projectID,
		"key":        key,
	}, "", &out)
	return LookupResult{
		Hit: out.Hit, HomeProjectID: out.HomeProjectID, HomeCellURL: out.HomeCellURL, State: out.State,
	}, out.Trace, err
}

// LookupWalk starts at projectID on startCellURL and walks UP parent project pointers only.
func (c *PeerClient) LookupWalk(ctx context.Context, startCellURL, projectID, key string) (LookupResult, []TraceHop, error) {
	var trace []TraceHop
	cellURL := NormalizeURL(startCellURL)
	curProjectID := projectID
	for {
		proj, err := c.GetProject(ctx, cellURL, curProjectID)
		if err != nil {
			return LookupResult{}, trace, err
		}
		res, hops, err := c.Lookup(ctx, cellURL, curProjectID, key)
		trace = append(trace, hops...)
		if err != nil {
			return LookupResult{}, trace, err
		}
		if res.Hit {
			res.FoundAtProjectID = curProjectID
			return res, trace, nil
		}
		if proj.ParentProjectID == "" || proj.ParentCellURL == "" {
			return LookupResult{Hit: false}, trace, nil
		}
		cellURL = NormalizeURL(proj.ParentCellURL)
		curProjectID = proj.ParentProjectID
	}
}

type RegisterInterestRequest struct {
	PrincipalKey        string `json:"principal_key"`
	HomeProjectID       string `json:"home_project_id"`
	SubscriberCellURL   string `json:"subscriber_cell_url"`
	SubscriberProjectID string `json:"subscriber_project_id"`
	TupleID             string `json:"tuple_id"`
	Object              string `json:"object,omitempty"`
	Relation            string `json:"relation,omitempty"`
}

func (c *PeerClient) RegisterInterest(ctx context.Context, homeCellURL string, req RegisterInterestRequest) error {
	return c.doJSON(ctx, http.MethodPost, NormalizeURL(homeCellURL)+"/v1/interests", req, "", nil)
}

type CreateTupleResponse struct {
	Tuple TupleView  `json:"tuple"`
	Trace []TraceHop `json:"trace"`
	Error string     `json:"error"`
}

func (c *PeerClient) CreateTuple(ctx context.Context, cellURL, projectID string, body map[string]any) (CreateTupleResponse, error) {
	var out CreateTupleResponse
	err := c.doJSONAllowError(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/tuples", body, &out)
	if err != nil {
		return out, err
	}
	if out.Error != "" {
		return out, fmt.Errorf("%s", out.Error)
	}
	return out, nil
}

// doJSONAllowError unmarshals the body even when status >= 300 so callers can keep traces.
func (c *PeerClient) doJSONAllowError(ctx context.Context, method, url string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if out != nil && len(data) > 0 {
		_ = json.Unmarshal(data, out)
	}
	if res.StatusCode >= 300 {
		var er struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &er)
		if er.Error != "" {
			return fmt.Errorf("%s", er.Error)
		}
		return fmt.Errorf("http %d: %s", res.StatusCode, string(data))
	}
	return nil
}

func (c *PeerClient) CreateApp(ctx context.Context, cellURL, projectID string, body map[string]any) (AppView, error) {
	var out AppView
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/apps", body, "", &out)
	return out, err
}

func (c *PeerClient) ListApps(ctx context.Context, cellURL, projectID string) ([]AppView, error) {
	var out struct {
		Apps []AppView `json:"apps"`
	}
	err := c.doJSON(ctx, http.MethodGet, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/apps", nil, "", &out)
	return out.Apps, err
}

func (c *PeerClient) ListTuples(ctx context.Context, cellURL, projectID string) ([]TupleView, error) {
	var out struct {
		Tuples []TupleView `json:"tuples"`
	}
	err := c.doJSON(ctx, http.MethodGet, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/tuples", nil, "", &out)
	return out.Tuples, err
}

func (c *PeerClient) ListInterests(ctx context.Context, cellURL string, homeProjectID string) ([]InterestView, error) {
	u := NormalizeURL(cellURL) + "/v1/interests"
	if homeProjectID != "" {
		u += "?home_project_id=" + homeProjectID
	}
	var out struct {
		Interests []InterestView `json:"interests"`
	}
	err := c.doJSON(ctx, http.MethodGet, u, nil, "", &out)
	return out.Interests, err
}

func (c *PeerClient) DoRaw(ctx context.Context, method, url string, body any, bearer string, out any) error {
	return c.doJSON(ctx, method, url, body, bearer, out)
}

func (c *PeerClient) GetJWKS(ctx context.Context, cellURL string) (JWKS, error) {
	var out JWKS
	err := c.doJSON(ctx, http.MethodGet, NormalizeURL(cellURL)+"/v1/jwks", nil, "", &out)
	return out, err
}

func (c *PeerClient) IssueToken(ctx context.Context, cellURL string, req IssueTokenRequest) (IssueTokenResponse, error) {
	var out IssueTokenResponse
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/token/issue", req, "", &out)
	return out, err
}

func (c *PeerClient) PrincipalCheck(ctx context.Context, cellURL string, req PrincipalCheckRequest) (PrincipalCheckResponse, error) {
	var out PrincipalCheckResponse
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/principal/check", req, "", &out)
	return out, err
}

func (c *PeerClient) AuthCheck(ctx context.Context, cellURL string, req AuthCheckRequest) (AuthCheckResponse, error) {
	var out AuthCheckResponse
	err := c.doJSONAllowError(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/auth/check", req, &out)
	return out, err
}

func (c *PeerClient) FGACheck(ctx context.Context, cellURL string, req FGACheckRequest) (FGACheckResponse, error) {
	var out FGACheckResponse
	err := c.doJSONAllowError(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/fga/check", req, &out)
	return out, err
}

func (c *PeerClient) FGAExpand(ctx context.Context, cellURL string, req FGAExpandRequest) (FGAExpandResponse, error) {
	var out FGAExpandResponse
	err := c.doJSONAllowError(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/fga/expand", req, &out)
	if err != nil {
		return out, err
	}
	return out, nil
}

func (c *PeerClient) doJSON(ctx context.Context, method, url string, body any, bearer string, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode >= 300 {
		var er struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &er)
		if er.Error != "" {
			return fmt.Errorf("%s", er.Error)
		}
		return fmt.Errorf("http %d: %s", res.StatusCode, string(data))
	}
	if out == nil || res.StatusCode == http.StatusNoContent || len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}
