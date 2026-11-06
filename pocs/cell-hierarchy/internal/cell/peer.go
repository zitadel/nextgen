package cell

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// TraceSink receives one hop after every outbound PeerClient HTTP call.
type TraceSink func(TraceHop)

type fromCellCtxKey struct{}

// WithFromCellURL tags ctx so the next outbound request delays as from→to.
func WithFromCellURL(ctx context.Context, cellURL string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, fromCellCtxKey{}, NormalizeURL(cellURL))
}

// FromCellURL returns the caller cell URL from ctx, if set.
func FromCellURL(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(fromCellCtxKey{}).(string)
	return v
}

type PeerClient struct {
	HTTP *http.Client

	// ExtraDelay is a flat sleep before each request (legacy; prefer PairDelays).
	ExtraDelay time.Duration

	// ApplyPairDelays enables WAN simulation sleeps. Cell servers turn this on
	// when they receive /v1/admin/delays. The UI PeerClient must keep this false
	// so console→cell calls stay instant; only cell→cell hops simulate latency.
	ApplyPairDelays bool

	// PairDelays maps canonical "a|b" (sorted labels) → milliseconds.
	// Protected by delayMu.
	PairDelays map[string]int
	// URLLabels maps normalized cell base URL → label (e.g. eu-1).
	URLLabels map[string]string
	// SelfURL is this process's cell URL (cell-server Peer); used as from when ctx has none.
	SelfURL string

	// OnHop is called after every HTTP attempt (success or failure).
	OnHop TraceSink

	delayMu sync.RWMutex
}

func NewPeerClient() *PeerClient {
	// Longer timeout so pairwise-delay demos (per-hop sleep) do not abort mid-chain.
	return &PeerClient{
		HTTP:       &http.Client{Timeout: 60 * time.Second},
		PairDelays: map[string]int{},
		URLLabels:  map[string]string{},
	}
}

// PairKey returns the canonical sorted key for two cell labels.
func PairKey(a, b string) string {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a > b {
		a, b = b, a
	}
	return a + "|" + b
}

// SetDelayConfig replaces pairwise delays and URL→label map.
func (c *PeerClient) SetDelayConfig(pairs map[string]int, labels map[string]string) {
	if c == nil {
		return
	}
	c.delayMu.Lock()
	defer c.delayMu.Unlock()
	c.PairDelays = map[string]int{}
	for k, v := range pairs {
		if v < 0 {
			v = 0
		}
		c.PairDelays[k] = v
	}
	c.URLLabels = map[string]string{}
	for u, label := range labels {
		c.URLLabels[NormalizeURL(u)] = label
	}
}

// LabelForURL resolves a request or base URL to a cell label.
func (c *PeerClient) LabelForURL(raw string) string {
	if c == nil {
		return ""
	}
	base := BaseURLOf(raw)
	c.delayMu.RLock()
	defer c.delayMu.RUnlock()
	if label, ok := c.URLLabels[base]; ok {
		return label
	}
	return ""
}

// DelayBetween returns sleep duration for a hop from→to.
// Same-cell = 0. Listed pairs use the matrix. Both labels known but unlisted = 0.
// Either side unlabeled = 50ms (unknown hop).
// Returns 0 when ApplyPairDelays is false (UI / non-WAN clients).
func (c *PeerClient) DelayBetween(fromURL, toURL string) time.Duration {
	if c == nil || !c.ApplyPairDelays {
		return 0
	}
	fromLabel := c.LabelForURL(fromURL)
	toLabel := c.LabelForURL(toURL)
	if fromLabel != "" && toLabel != "" && fromLabel == toLabel {
		return 0
	}
	if fromLabel == "" || toLabel == "" {
		if fromURL != "" && toURL != "" && BaseURLOf(fromURL) == BaseURLOf(toURL) {
			return 0
		}
		return 50 * time.Millisecond
	}
	key := PairKey(fromLabel, toLabel)
	c.delayMu.RLock()
	ms, ok := c.PairDelays[key]
	c.delayMu.RUnlock()
	if !ok {
		return 0
	}
	return time.Duration(ms) * time.Millisecond
}

// BaseURLOf strips path/query from a URL, returning scheme://host.
func BaseURLOf(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return NormalizeURL(raw)
	}
	return NormalizeURL(u.Scheme + "://" + u.Host)
}

// DefaultPairDelays returns the POC demo matrix (ms).
func DefaultPairDelays() map[string]int {
	return map[string]int{
		PairKey("eu-1", "eu-2"): 20,
		PairKey("eu-1", "us-1"): 100,
		PairKey("eu-1", "us-2"): 200,
		PairKey("eu-2", "us-1"): 150,
		PairKey("eu-2", "us-2"): 250,
		PairKey("us-1", "us-2"): 10,
	}
}

// SortedPairKeys returns matrix keys sorted for stable UI/forms.
func SortedPairKeys(pairs map[string]int) []string {
	keys := make([]string, 0, len(pairs))
	for k := range pairs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

type MeResponse struct {
	URL       string `json:"url"`
	Label     string `json:"label"`
	Display   string `json:"display,omitempty"`
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
	WorkspaceID     string `json:"workspace_id,omitempty"`
	CustomerTeamID  string `json:"customer_team_id,omitempty"`
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
	User  UserView   `json:"user"`
	Trace []TraceHop `json:"trace"`
	Error string     `json:"error"`
}

func (c *PeerClient) CreateUser(ctx context.Context, cellURL, projectID, email string, deferFloat bool) (CreateUserResponse, error) {
	return c.CreateUserBody(ctx, cellURL, projectID, map[string]any{
		"email":       email,
		"defer_float": deferFloat,
	})
}

func (c *PeerClient) CreateUserBody(ctx context.Context, cellURL, projectID string, body map[string]any) (CreateUserResponse, error) {
	var out CreateUserResponse
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/users", body, "", &out)
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
	ViaProject    string `json:"via_project,omitempty"`
}

func (c *PeerClient) PushLookup(ctx context.Context, cellURL string, req PushLookupRequest) error {
	return c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/lookup/push", req, "", nil)
}

type LookupResult struct {
	Hit              bool   `json:"hit"`
	Tombstoned       bool   `json:"tombstoned,omitempty"`
	HomeProjectID    string `json:"home_project_id"`
	HomeCellURL      string `json:"home_cell_url"`
	State            string `json:"state,omitempty"`
	FoundAtProjectID string `json:"found_at,omitempty"`
}

func (c *PeerClient) Lookup(ctx context.Context, cellURL, projectID, key string) (LookupResult, []TraceHop, error) {
	var out struct {
		Hit           bool       `json:"hit"`
		Tombstoned    bool       `json:"tombstoned"`
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
		Hit: out.Hit, Tombstoned: out.Tombstoned || out.State == LookupStateTombstone,
		HomeProjectID: out.HomeProjectID, HomeCellURL: out.HomeCellURL, State: out.State,
	}, out.Trace, err
}

// LookupWalk asks the entry cell to walk the parent site chain.
// The client makes one POST /v1/lookup/walk; the cell delegates to parents.
// UI entry hops use zero pairwise delay (from=target when no SelfURL/ctx from).
func (c *PeerClient) LookupWalk(ctx context.Context, startCellURL, projectID, key string) (LookupResult, []TraceHop, error) {
	if FromCellURL(ctx) == "" && (c == nil || c.SelfURL == "") {
		ctx = WithFromCellURL(ctx, startCellURL)
	}
	return c.LookupWalkRemote(ctx, startCellURL, projectID, key)
}

// LookupWalkRemote POSTs /v1/lookup/walk on cellURL (cell→parent Peer hop).
// Pairwise delay applies via applyExtraDelay (SelfURL / FromCellURL → target).
func (c *PeerClient) LookupWalkRemote(ctx context.Context, cellURL, projectID, key string) (LookupResult, []TraceHop, error) {
	var out struct {
		Hit           bool       `json:"hit"`
		Tombstoned    bool       `json:"tombstoned"`
		HomeProjectID string     `json:"home_project_id"`
		HomeCellURL   string     `json:"home_cell_url"`
		State         string     `json:"state"`
		FoundAt       string     `json:"found_at"`
		Trace         []TraceHop `json:"trace"`
		Error         string     `json:"error"`
	}
	err := c.doJSONAllowError(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/lookup/walk", map[string]any{
		"project_id": projectID,
		"key":        key,
	}, &out)
	if err != nil {
		return LookupResult{}, out.Trace, err
	}
	if out.Error != "" {
		return LookupResult{}, out.Trace, fmt.Errorf("%s", out.Error)
	}
	return LookupResult{
		Hit: out.Hit, Tombstoned: out.Tombstoned || out.State == LookupStateTombstone,
		HomeProjectID: out.HomeProjectID, HomeCellURL: out.HomeCellURL,
		State: out.State, FoundAtProjectID: out.FoundAt,
	}, out.Trace, nil
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
func (c *PeerClient) doJSONAllowError(ctx context.Context, method, reqURL string, body any, out any) error {
	return c.doHTTP(ctx, method, reqURL, body, "", out, true)
}

func (c *PeerClient) CreateApp(ctx context.Context, cellURL, projectID string, body map[string]any) (AppView, error) {
	var out AppView
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/apps", body, "", &out)
	return out, err
}

func (c *PeerClient) DeleteApp(ctx context.Context, cellURL, projectID, appID string) error {
	return c.doJSON(ctx, http.MethodDelete, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/apps/"+appID, nil, "", nil)
}

func (c *PeerClient) ListTeams(ctx context.Context, cellURL, projectID string) ([]TeamView, error) {
	var out struct {
		Teams []TeamView `json:"teams"`
	}
	err := c.doJSON(ctx, http.MethodGet, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/teams", nil, "", &out)
	return out.Teams, err
}

func (c *PeerClient) CreateTeam(ctx context.Context, cellURL, projectID string, body map[string]any) (TeamView, error) {
	var out TeamView
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/teams", body, "", &out)
	return out, err
}

func (c *PeerClient) DeleteTeam(ctx context.Context, cellURL, projectID, teamID string) error {
	return c.doJSON(ctx, http.MethodDelete, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/teams/"+teamID, nil, "", nil)
}

func (c *PeerClient) ListGroups(ctx context.Context, cellURL, projectID string) ([]GroupView, error) {
	var out struct {
		Groups []GroupView `json:"groups"`
	}
	err := c.doJSON(ctx, http.MethodGet, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/groups", nil, "", &out)
	return out.Groups, err
}

func (c *PeerClient) CreateGroup(ctx context.Context, cellURL, projectID string, body map[string]any) (GroupView, error) {
	var out GroupView
	err := c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/groups", body, "", &out)
	return out, err
}

func (c *PeerClient) DeleteGroup(ctx context.Context, cellURL, projectID, groupID string) error {
	return c.doJSON(ctx, http.MethodDelete, NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/groups/"+groupID, nil, "", nil)
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

func (c *PeerClient) TombstoneTuple(ctx context.Context, cellURL, projectID, tupleID string) (TombstoneTupleResponse, error) {
	var out TombstoneTupleResponse
	err := c.doJSONAllowError(ctx, http.MethodPost,
		NormalizeURL(cellURL)+"/v1/projects/"+projectID+"/tuples/"+tupleID+"/tombstone",
		map[string]any{}, &out)
	return out, err
}

func (c *PeerClient) UnregisterInterestByTuple(ctx context.Context, homeCellURL, tupleID string) error {
	return c.doJSON(ctx, http.MethodDelete,
		NormalizeURL(homeCellURL)+"/v1/interests/by-tuple/"+tupleID, nil, "", nil)
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

func (c *PeerClient) PushLifecycleEvent(ctx context.Context, subscriberCellURL string, req LifecycleEventRequest) error {
	return c.doJSON(ctx, http.MethodPost, NormalizeURL(subscriberCellURL)+"/v1/events/user", req, "", nil)
}

func (c *PeerClient) PushLookupTombstone(ctx context.Context, cellURL string, req PushLookupRequest) error {
	return c.doJSON(ctx, http.MethodPost, NormalizeURL(cellURL)+"/v1/lookup/tombstone", req, "", nil)
}

func (c *PeerClient) BlockUser(ctx context.Context, cellURL, projectID, key string) (BlockUserResponse, error) {
	var out BlockUserResponse
	path := NormalizeURL(cellURL) + "/v1/projects/" + projectID + "/users/" + url.PathEscape(key) + "/block"
	err := c.doJSONAllowError(ctx, http.MethodPost, path, map[string]any{}, &out)
	return out, err
}

func (c *PeerClient) DeleteUser(ctx context.Context, cellURL, projectID, key string) (DeleteUserResponse, error) {
	var out DeleteUserResponse
	path := NormalizeURL(cellURL) + "/v1/projects/" + projectID + "/users/" + url.PathEscape(key) + "/delete"
	err := c.doJSONAllowError(ctx, http.MethodPost, path, map[string]any{}, &out)
	return out, err
}

func (c *PeerClient) applyExtraDelay(ctx context.Context, toURL string) error {
	if c == nil {
		return nil
	}
	from := FromCellURL(ctx)
	if from == "" {
		from = c.SelfURL
	}
	d := c.DelayBetween(from, toURL)
	if c.ExtraDelay > 0 {
		d += c.ExtraDelay
	}
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (c *PeerClient) emitHop(cellURL, methodPath string, ms int64, result string) {
	if c == nil || c.OnHop == nil {
		return
	}
	c.OnHop(TraceHop{
		Cell:   BaseURLOf(cellURL),
		Method: methodPath,
		Ms:     ms,
		Result: result,
	})
}

func (c *PeerClient) doJSON(ctx context.Context, method, reqURL string, body any, bearer string, out any) error {
	return c.doHTTP(ctx, method, reqURL, body, bearer, out, false)
}

func (c *PeerClient) doHTTP(ctx context.Context, method, reqURL string, body any, bearer string, out any, allowErrorBody bool) error {
	if err := c.applyExtraDelay(ctx, reqURL); err != nil {
		c.emitHop(reqURL, method+" "+pathOfURL(reqURL), 0, "error:"+err.Error())
		return err
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, reqURL, rdr)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	start := time.Now()
	res, err := c.HTTP.Do(req)
	elapsed := time.Since(start).Milliseconds()
	methodPath := method + " " + pathOfURL(reqURL)
	if err != nil {
		c.emitHop(reqURL, methodPath, elapsed, "error:"+err.Error())
		return err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		c.emitHop(reqURL, methodPath, elapsed, "error:"+err.Error())
		return err
	}
	if allowErrorBody && out != nil && len(data) > 0 {
		_ = json.Unmarshal(data, out)
	}
	if res.StatusCode >= 300 {
		var er struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &er)
		detail := fmt.Sprintf("http %d", res.StatusCode)
		if er.Error != "" {
			detail = er.Error
		}
		c.emitHop(reqURL, methodPath, elapsed, detail)
		if er.Error != "" {
			return fmt.Errorf("%s", er.Error)
		}
		return fmt.Errorf("http %d: %s", res.StatusCode, string(data))
	}
	c.emitHop(reqURL, methodPath, elapsed, fmt.Sprintf("%d", res.StatusCode))
	if allowErrorBody {
		return nil
	}
	if out == nil || res.StatusCode == http.StatusNoContent || len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

func pathOfURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Path == "" {
		return raw
	}
	if u.RawQuery != "" {
		return u.Path + "?" + u.RawQuery
	}
	return u.Path
}
