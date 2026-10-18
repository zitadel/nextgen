package ui

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

//go:embed templates/*.html
var templateFS embed.FS

type CellRef struct {
	Label string
	URL   string
}

type App struct {
	Cells []CellRef
	Peer  *cell.PeerClient
	Log   *log.Logger
	tmpl  *template.Template

	traceMu sync.Mutex
	trace   []traceEntry

	signInMu sync.Mutex
	signIn   *signInResult

	groupCheckMu sync.Mutex
	groupCheck   *groupCheckResult
}

type traceEntry struct {
	At     string
	Action string
	Hops   []cell.TraceHop
	Note   string
}

func NewApp(cells []CellRef, logger *log.Logger) (*App, error) {
	if logger == nil {
		logger = log.Default()
	}
	tmpl, err := template.New("").Funcs(template.FuncMap{
		"queryEscape": url.QueryEscape,
	}).ParseFS(templateFS, "templates/*.html")
	if err != nil {
		return nil, err
	}
	return &App{Cells: cells, Peer: cell.NewPeerClient(), Log: logger, tmpl: tmpl}, nil
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", a.handleHome)
	mux.HandleFunc("GET /tree", a.handleTree)
	mux.HandleFunc("GET /join", a.handleJoinForm)
	mux.HandleFunc("POST /join", a.handleJoinSubmit)
	mux.HandleFunc("GET /cells/{label}", a.handleCellDetail)
	mux.HandleFunc("GET /projects/{id}", a.handleProjectDetail)
	mux.HandleFunc("GET /scenarios", a.handleScenarios)
	mux.HandleFunc("POST /scenarios/create-user", a.handleScenarioCreateUser)
	mux.HandleFunc("POST /scenarios/lookup", a.handleScenarioLookup)
	mux.HandleFunc("POST /scenarios/grant-joe", a.handleScenarioGrantJoe)
	mux.HandleFunc("POST /scenarios/sign-in-joe", a.handleScenarioSignInJoe)
	mux.HandleFunc("POST /scenarios/seed-group-chain", a.handleScenarioSeedGroupChain)
	mux.HandleFunc("POST /scenarios/group-check-joe", a.handleScenarioGroupCheckJoe)
	mux.HandleFunc("GET /trace", a.handleTrace)
	mux.HandleFunc("POST /trace/clear", a.handleTraceClear)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	return mux
}

type snapshotNode struct {
	Label     string
	URL       string
	IsParent  bool
	ParentURL string
	Status    string
	Alive     bool
	Reachable bool
	Children  []*snapshotNode
	Error     string
}

type projectNode struct {
	ID            string
	Name          string
	HostCellURL   string
	HostLabel     string
	IsParent      bool
	LookupEnabled bool
	ParentID      string
	Children      []*projectNode
}

type pageData struct {
	Title       string
	Flash       string
	FlashErr    string
	Tree        []*snapshotNode
	Unjoined    []*snapshotNode
	ProjectTree []*projectNode
	Parents     []CellRef
	UnjoinedO   []CellRef
	Detail      *cellDetail
	Project     *projectDetail
	Trace       []traceEntry
	Now         string
	ScenarioOK  string
	ScenarioErr string
	SignIn      *signInResult
	GroupCheck  *groupCheckResult
}

type signInResult struct {
	Token          string
	ClaimsJSON     string
	AllowedOffline bool
	ReasonOffline  string
	AllowedOnline  bool
	ReasonOnline   string
	AutoGranted    bool
	LookupHit      bool
	HomeProject    string
	HomeCell       string
}

type groupCheckResult struct {
	Allowed       bool
	Reason        string
	DelayMs       int
	TotalMs       int64
	CrossCellHops int
	Hops          []cell.TraceHop
	Seeded        bool
	Note          string
}

type cellDetail struct {
	Me       cell.MeResponse
	Children []childRow
	Projects []cell.ProjectResponse
	Error    string
}

type projectDetail struct {
	Project   cell.ProjectResponse
	Users     []userRow
	Lookup    []lookupRow
	Apps      []cell.AppView
	Tuples    []cell.TupleView
	Interests []cell.InterestView
	Error     string
}

type userRow struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	Email     string `json:"email"`
	CreatedAt string `json:"created_at"`
}

type lookupRow struct {
	Key           string `json:"key"`
	HomeProjectID string `json:"home_project_id"`
	HomeCellURL   string `json:"home_cell_url"`
	State         string `json:"state"`
	UpdatedAt     string `json:"updated_at"`
}

type childRow struct {
	ChildURL   string `json:"child_url"`
	Label      string `json:"label"`
	Alive      bool   `json:"alive"`
	LastSeenAt string `json:"last_seen_at"`
}

func (a *App) handleHome(w http.ResponseWriter, r *http.Request) {
	tree, unjoined := a.buildTree(r.Context())
	a.render(w, "home", pageData{
		Title:       "Cell & project trees",
		Tree:        tree,
		Unjoined:    unjoined,
		ProjectTree: a.buildProjectTree(r.Context()),
		Trace:       a.copyTrace(),
		Now:         time.Now().UTC().Format(time.RFC3339),
	})
}

func (a *App) handleTree(w http.ResponseWriter, r *http.Request) {
	tree, unjoined := a.buildTree(r.Context())
	a.render(w, "tree", pageData{
		Tree:        tree,
		Unjoined:    unjoined,
		ProjectTree: a.buildProjectTree(r.Context()),
		Now:         time.Now().UTC().Format(time.RFC3339),
	})
}

func (a *App) handleJoinForm(w http.ResponseWriter, r *http.Request) {
	parents, unjoined := a.joinOptions(r.Context())
	a.render(w, "join", pageData{
		Title:     "Join cell",
		Parents:   parents,
		UnjoinedO: unjoined,
		Flash:     r.URL.Query().Get("ok"),
		FlashErr:  r.URL.Query().Get("err"),
	})
}

func (a *App) handleJoinSubmit(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/join?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	parentURL := r.FormValue("parent_url")
	childURL := r.FormValue("child_url")
	if parentURL == "" || childURL == "" {
		http.Redirect(w, r, "/join?err="+url.QueryEscape("parent and child required"), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	invite, err := a.Peer.Prepare(ctx, parentURL)
	if err != nil {
		http.Redirect(w, r, "/join?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	_, err = a.Peer.Accept(ctx, childURL, cell.AcceptRequest{
		ParentURL: invite.ParentURL,
		JoinToken: invite.JoinToken,
	})
	if err != nil {
		http.Redirect(w, r, "/join?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/join?ok="+url.QueryEscape("joined successfully"), http.StatusSeeOther)
}

func (a *App) handleCellDetail(w http.ResponseWriter, r *http.Request) {
	label := r.PathValue("label")
	ref, ok := a.findByLabel(label)
	if !ok {
		http.NotFound(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	detail := &cellDetail{}
	me, err := a.Peer.GetMe(ctx, ref.URL)
	if err != nil {
		detail.Error = err.Error()
	} else {
		detail.Me = me
		children, err := a.fetchChildren(ctx, ref.URL)
		if err != nil {
			detail.Error = err.Error()
		} else {
			detail.Children = children
		}
		projects, err := a.Peer.ListProjects(ctx, ref.URL)
		if err != nil {
			detail.Error = err.Error()
		} else {
			detail.Projects = projects
		}
	}
	a.render(w, "detail", pageData{Title: "Cell " + label, Detail: detail})
}

func (a *App) handleProjectDetail(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	detail := &projectDetail{}
	hostURL, proj, err := a.findProject(ctx, id)
	if err != nil {
		detail.Error = err.Error()
		a.render(w, "project", pageData{Title: "Project " + id, Project: detail})
		return
	}
	detail.Project = proj
	var raw struct {
		Users     []userRow           `json:"users"`
		Lookup    []lookupRow         `json:"lookup"`
		Apps      []cell.AppView      `json:"apps"`
		Tuples    []cell.TupleView    `json:"tuples"`
		Interests []cell.InterestView `json:"interests"`
	}
	if err := a.Peer.DoRaw(ctx, http.MethodGet, cell.NormalizeURL(hostURL)+"/v1/projects/"+id, nil, "", &raw); err != nil {
		detail.Error = err.Error()
	} else {
		detail.Users = raw.Users
		detail.Lookup = raw.Lookup
		detail.Apps = raw.Apps
		detail.Tuples = raw.Tuples
		detail.Interests = raw.Interests
	}
	a.render(w, "project", pageData{Title: "Project " + id, Project: detail, Trace: a.copyTrace()})
}

func (a *App) handleScenarios(w http.ResponseWriter, r *http.Request) {
	a.render(w, "scenarios", pageData{
		Title:       "Scenarios",
		Trace:       a.copyTrace(),
		ScenarioOK:  r.URL.Query().Get("ok"),
		ScenarioErr: r.URL.Query().Get("err"),
		SignIn:      a.copySignIn(),
		GroupCheck:  a.copyGroupCheck(),
	})
}

func (a *App) handleScenarioCreateUser(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	email := strings.TrimSpace(r.FormValue("email"))
	if email == "" {
		email = fmt.Sprintf("demo-%d@example.com", time.Now().Unix()%100000)
	}
	deferFloat := r.FormValue("defer_float") == "1"
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	host, err := a.cellURLByLabel("eu-2")
	if err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	out, err := a.Peer.CreateUser(ctx, host, "team-eu-2", email, deferFloat)
	note := "create " + email + " on team-eu-2"
	if deferFloat {
		note += " (defer float)"
	}
	if err != nil {
		a.appendTrace(note, out.Trace, err.Error())
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.appendTrace(note, out.Trace, "created")
	http.Redirect(w, r, "/scenarios?ok="+url.QueryEscape("created "+email), http.StatusSeeOther)
}

func (a *App) handleScenarioLookup(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	key := strings.TrimSpace(r.FormValue("key"))
	if key == "" {
		key = "joe@example.com"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	host, err := a.cellURLByLabel("us")
	if err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	res, hops, err := a.Peer.LookupWalk(ctx, host, "us", key)
	if err != nil {
		a.appendTrace("lookup walk from us: "+key, hops, err.Error())
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	note := "miss"
	if res.Hit {
		note = "hit home=" + res.HomeProjectID + " at=" + res.FoundAtProjectID
	}
	a.appendTrace("lookup walk from us: "+key, hops, note)
	msg := note
	http.Redirect(w, r, "/scenarios?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}

func (a *App) handleScenarioGrantJoe(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if _, err := a.ensureJoeGrant(ctx); err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/scenarios?ok="+url.QueryEscape("granted joe viewer on us/chat"), http.StatusSeeOther)
}

func (a *App) handleScenarioSignInJoe(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	// Checkbox only posts when checked.
	autoGrant := r.FormValue("auto_grant") == "1"

	usHost, err := a.cellURLByLabel("us")
	if err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	key := "joe@example.com"
	var allHops []cell.TraceHop

	// 1) Lookup walk from us → home.
	res, hops, err := a.Peer.LookupWalk(ctx, usHost, "us", key)
	allHops = append(allHops, hops...)
	if err != nil {
		a.appendTrace("sign-in joe: lookup", allHops, err.Error())
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	if !res.Hit {
		a.appendTrace("sign-in joe: lookup", allHops, "miss — run grant / seed float first")
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape("lookup miss for joe@example.com from us (float may be pending)"), http.StatusSeeOther)
		return
	}
	a.appendTrace("sign-in joe: lookup", hops, "hit home="+res.HomeProjectID+" cell="+res.HomeCellURL)

	// 2) Optionally ensure grant exists (Phase 3) before auth check.
	autoGranted := false
	tuples, err := a.Peer.ListTuples(ctx, usHost, "us")
	if err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	hasGrant := false
	for _, tup := range tuples {
		if tup.Object == "app:chat" && tup.Relation == "viewer" && tup.UserKey == key {
			hasGrant = true
			break
		}
	}
	if !hasGrant {
		if !autoGrant {
			a.appendTrace("sign-in joe: grant", nil, "missing — run Phase 3 grant scenario first")
			http.Redirect(w, r, "/scenarios?err="+url.QueryEscape("no grant for joe on us/chat — run Grant Joe scenario or enable auto-grant"), http.StatusSeeOther)
			return
		}
		if _, err := a.ensureJoeGrant(ctx); err != nil {
			http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
			return
		}
		autoGranted = true
	}

	// 3) Issue token at home cell.
	issued, err := a.Peer.IssueToken(ctx, res.HomeCellURL, cell.IssueTokenRequest{
		ProjectID: res.HomeProjectID,
		Sub:       key,
		Aud:       "app:chat",
	})
	issueHop := []cell.TraceHop{{
		Cell: res.HomeCellURL, Method: "POST /v1/token/issue", Result: "ok",
	}}
	if err != nil {
		a.appendTrace("sign-in joe: issue", append(allHops, issueHop...), err.Error())
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.appendTrace("sign-in joe: issue", issueHop, "token issued epoch="+fmt.Sprintf("%d", issued.Claims.Epoch))

	claimsJSON, _ := json.MarshalIndent(issued.Claims, "", "  ")
	result := &signInResult{
		Token:       issued.Token,
		ClaimsJSON:  string(claimsJSON),
		AutoGranted: autoGranted,
		LookupHit:   true,
		HomeProject: res.HomeProjectID,
		HomeCell:    res.HomeCellURL,
	}

	// 4) Auth check on us — offline then online.
	offline, err := a.Peer.AuthCheck(ctx, usHost, cell.AuthCheckRequest{
		Token: issued.Token, ProjectID: "us", Object: "app:chat", Relation: "viewer", Online: false,
	})
	if err != nil {
		a.appendTrace("sign-in joe: auth offline", offline.Trace, err.Error())
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	result.AllowedOffline = offline.Allowed
	result.ReasonOffline = offline.Reason
	a.appendTrace("sign-in joe: auth offline", offline.Trace, offline.Reason)

	online, err := a.Peer.AuthCheck(ctx, usHost, cell.AuthCheckRequest{
		Token: issued.Token, ProjectID: "us", Object: "app:chat", Relation: "viewer", Online: true,
	})
	if err != nil {
		a.appendTrace("sign-in joe: auth online", online.Trace, err.Error())
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	result.AllowedOnline = online.Allowed
	result.ReasonOnline = online.Reason
	a.appendTrace("sign-in joe: auth online", online.Trace, online.Reason)

	a.setSignIn(result)
	msg := "signed in joe on us"
	if autoGranted {
		msg += " (auto-granted)"
	}
	if !online.Allowed {
		msg += " — denied: " + online.Reason
	}
	http.Redirect(w, r, "/scenarios?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}

func (a *App) handleScenarioSeedGroupChain(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	if err := a.ensureGroupChain(ctx); err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/scenarios?ok="+url.QueryEscape("seeded group chain A→B→chat"), http.StatusSeeOther)
}

func (a *App) handleScenarioGroupCheckJoe(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	delayMs := 0
	if v := strings.TrimSpace(r.FormValue("delay_ms")); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			delayMs = n
		}
	}
	if delayMs < 0 {
		delayMs = 0
	}
	if delayMs > 500 {
		delayMs = 500
	}
	autoSeed := r.FormValue("auto_seed") == "1"

	usHost, err := a.cellURLByLabel("us")
	if err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}

	seeded := false
	if autoSeed {
		if err := a.ensureGroupChain(ctx); err != nil {
			http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
			return
		}
		seeded = true
	}

	res, err := a.Peer.FGACheck(ctx, usHost, cell.FGACheckRequest{
		ProjectID: "us",
		Object:    "app:chat",
		Relation:  "viewer",
		UserKey:   "joe@example.com",
		DelayMs:   &delayMs,
	})
	if err != nil {
		a.appendTrace("group check joe → app:chat", res.Trace, err.Error())
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	note := fmt.Sprintf("allowed=%v total_ms=%d cross_cell_hops=%d delay_ms=%d",
		res.Allowed, res.TotalMs, res.CrossCellHops, delayMs)
	a.appendTrace("group check joe → app:chat", res.Trace, note)

	result := &groupCheckResult{
		Allowed:       res.Allowed,
		Reason:        res.Reason,
		DelayMs:       delayMs,
		TotalMs:       res.TotalMs,
		CrossCellHops: res.CrossCellHops,
		Hops:          res.Trace,
		Seeded:        seeded,
		Note:          "Compare with Phase 3/4 flattened direct grant (app:chat#viewer@user:joe) — one local hop, no cross-cell expand.",
	}
	a.setGroupCheck(result)

	msg := fmt.Sprintf("group check: %s · %dms · %d cross-cell hops", res.Reason, res.TotalMs, res.CrossCellHops)
	if !res.Allowed {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(msg), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/scenarios?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}

func (a *App) ensureGroupChain(ctx context.Context) error {
	euHost, err := a.cellURLByLabel("eu")
	if err != nil {
		return err
	}
	eu2Host, err := a.cellURLByLabel("eu-2")
	if err != nil {
		return err
	}
	usHost, err := a.cellURLByLabel("us")
	if err != nil {
		return err
	}

	apps, err := a.Peer.ListApps(ctx, usHost, "us")
	if err != nil {
		return err
	}
	hasChat := false
	for _, app := range apps {
		if app.Name == "chat" {
			hasChat = true
			break
		}
	}
	if !hasChat {
		if _, err := a.Peer.CreateApp(ctx, usHost, "us", map[string]any{"name": "chat"}); err != nil {
			return err
		}
	}

	type seed struct {
		cellURL, projectID string
		body               map[string]any
		label              string
	}
	seeds := []seed{
		{
			cellURL: eu2Host, projectID: "team-eu-2", label: "group:A#member@user:joe",
			body: map[string]any{
				"object": "group:A", "relation": "member", "user_key": "joe@example.com",
				"subject_kind": "user", "home_project_id": "team-eu-2", "home_cell_url": eu2Host,
				"skip_interest": true,
			},
		},
		{
			cellURL: euHost, projectID: "eu", label: "group:B#member@group:A@team-eu-2",
			body: map[string]any{
				"object": "group:B", "relation": "member",
				"subject_kind": "group", "user_key": "A",
				"home_project_id": "team-eu-2", "home_cell_url": eu2Host,
			},
		},
		{
			cellURL: usHost, projectID: "us", label: "app:chat#viewer@group:B@eu",
			body: map[string]any{
				"object": "app:chat", "relation": "viewer",
				"subject_kind": "group", "user_key": "B",
				"home_project_id": "eu", "home_cell_url": euHost,
			},
		},
	}
	for _, s := range seeds {
		existing, err := a.Peer.ListTuples(ctx, s.cellURL, s.projectID)
		if err != nil {
			return err
		}
		wantKind, _ := s.body["subject_kind"].(string)
		wantKey, _ := s.body["user_key"].(string)
		wantObj, _ := s.body["object"].(string)
		wantRel, _ := s.body["relation"].(string)
		if wantKind == "" {
			wantKind = cell.SubjectKindUser
		}
		found := false
		for _, tup := range existing {
			if tup.Object == wantObj && tup.Relation == wantRel &&
				tup.SubjectKind == wantKind && tup.UserKey == wantKey {
				found = true
				a.appendTrace("seed "+s.label, nil, "already exists")
				break
			}
		}
		if found {
			continue
		}
		out, err := a.Peer.CreateTuple(ctx, s.cellURL, s.projectID, s.body)
		if err != nil {
			a.appendTrace("seed "+s.label, out.Trace, err.Error())
			return err
		}
		a.appendTrace("seed "+s.label, out.Trace, "tuple="+out.Tuple.ID)
	}
	return nil
}

func (a *App) setGroupCheck(gc *groupCheckResult) {
	a.groupCheckMu.Lock()
	defer a.groupCheckMu.Unlock()
	a.groupCheck = gc
}

func (a *App) copyGroupCheck() *groupCheckResult {
	a.groupCheckMu.Lock()
	defer a.groupCheckMu.Unlock()
	if a.groupCheck == nil {
		return nil
	}
	cp := *a.groupCheck
	if a.groupCheck.Hops != nil {
		cp.Hops = make([]cell.TraceHop, len(a.groupCheck.Hops))
		copy(cp.Hops, a.groupCheck.Hops)
	}
	return &cp
}

func (a *App) ensureJoeGrant(ctx context.Context) (cell.CreateTupleResponse, error) {
	usHost, err := a.cellURLByLabel("us")
	if err != nil {
		return cell.CreateTupleResponse{}, err
	}
	apps, err := a.Peer.ListApps(ctx, usHost, "us")
	if err != nil {
		return cell.CreateTupleResponse{}, err
	}
	hasChat := false
	for _, app := range apps {
		if app.Name == "chat" {
			hasChat = true
			break
		}
	}
	if !hasChat {
		if _, err := a.Peer.CreateApp(ctx, usHost, "us", map[string]any{"name": "chat"}); err != nil {
			return cell.CreateTupleResponse{}, err
		}
	}
	// Idempotent: if tuple already exists, treat as success.
	tuples, err := a.Peer.ListTuples(ctx, usHost, "us")
	if err != nil {
		return cell.CreateTupleResponse{}, err
	}
	for _, tup := range tuples {
		if tup.Object == "app:chat" && tup.Relation == "viewer" && tup.UserKey == "joe@example.com" {
			a.appendTrace("grant joe viewer on us/app:chat", nil, "already exists tuple="+tup.ID)
			return cell.CreateTupleResponse{Tuple: tup}, nil
		}
	}
	out, err := a.Peer.CreateTuple(ctx, usHost, "us", map[string]any{
		"object":   "app:chat",
		"relation": "viewer",
		"user_key": "joe@example.com",
	})
	note := "grant joe viewer on us/app:chat"
	if err != nil {
		a.appendTrace(note, out.Trace, err.Error())
		return out, err
	}
	a.appendTrace(note, out.Trace, "tuple="+out.Tuple.ID+" home="+out.Tuple.HomeProjectID)
	return out, nil
}

func (a *App) setSignIn(sr *signInResult) {
	a.signInMu.Lock()
	defer a.signInMu.Unlock()
	a.signIn = sr
}

func (a *App) copySignIn() *signInResult {
	a.signInMu.Lock()
	defer a.signInMu.Unlock()
	if a.signIn == nil {
		return nil
	}
	cp := *a.signIn
	return &cp
}

func (a *App) handleTrace(w http.ResponseWriter, r *http.Request) {
	a.render(w, "trace", pageData{Trace: a.copyTrace()})
}

func (a *App) handleTraceClear(w http.ResponseWriter, r *http.Request) {
	a.traceMu.Lock()
	a.trace = nil
	a.traceMu.Unlock()
	http.Redirect(w, r, "/scenarios", http.StatusSeeOther)
}

func (a *App) appendTrace(action string, hops []cell.TraceHop, note string) {
	a.traceMu.Lock()
	defer a.traceMu.Unlock()
	a.trace = append(a.trace, traceEntry{
		At:     time.Now().UTC().Format(time.RFC3339Nano),
		Action: action,
		Hops:   hops,
		Note:   note,
	})
	if len(a.trace) > 50 {
		a.trace = a.trace[len(a.trace)-50:]
	}
}

func (a *App) copyTrace() []traceEntry {
	a.traceMu.Lock()
	defer a.traceMu.Unlock()
	out := make([]traceEntry, len(a.trace))
	copy(out, a.trace)
	return out
}

func (a *App) cellURLByLabel(label string) (string, error) {
	ref, ok := a.findByLabel(label)
	if !ok {
		return "", fmt.Errorf("unknown cell %s", label)
	}
	return ref.URL, nil
}

func (a *App) findProject(ctx context.Context, id string) (string, cell.ProjectResponse, error) {
	for _, c := range a.Cells {
		projects, err := a.Peer.ListProjects(ctx, c.URL)
		if err != nil {
			continue
		}
		for _, p := range projects {
			if p.ID == id {
				return c.URL, p, nil
			}
		}
	}
	return "", cell.ProjectResponse{}, fmt.Errorf("project %s not found", id)
}

func (a *App) findByLabel(label string) (CellRef, bool) {
	for _, c := range a.Cells {
		if c.Label == label {
			return c, true
		}
	}
	return CellRef{}, false
}

func (a *App) joinOptions(ctx context.Context) (parents, unjoined []CellRef) {
	for _, c := range a.Cells {
		me, err := a.Peer.GetMe(ctx, c.URL)
		if err != nil {
			continue
		}
		if me.IsParent {
			parents = append(parents, CellRef{Label: me.Label, URL: me.URL})
		}
		if me.ParentURL == "" && !me.IsParent {
			unjoined = append(unjoined, CellRef{Label: me.Label, URL: me.URL})
		}
	}
	sort.Slice(parents, func(i, j int) bool { return parents[i].Label < parents[j].Label })
	sort.Slice(unjoined, func(i, j int) bool { return unjoined[i].Label < unjoined[j].Label })
	return parents, unjoined
}

func (a *App) buildTree(ctx context.Context) (roots, unjoined []*snapshotNode) {
	type live struct {
		ref CellRef
		me  cell.MeResponse
		err error
	}
	lives := make([]live, len(a.Cells))
	var wg sync.WaitGroup
	for i, c := range a.Cells {
		wg.Add(1)
		go func(i int, c CellRef) {
			defer wg.Done()
			me, err := a.Peer.GetMe(ctx, c.URL)
			lives[i] = live{ref: c, me: me, err: err}
		}(i, c)
	}
	wg.Wait()

	byURL := map[string]*snapshotNode{}
	var all []*snapshotNode
	for _, l := range lives {
		n := &snapshotNode{
			Label:     l.ref.Label,
			URL:       l.ref.URL,
			Reachable: l.err == nil,
			Alive:     l.err == nil,
		}
		if l.err != nil {
			n.Error = l.err.Error()
			n.Status = "unreachable"
		} else {
			n.Label = l.me.Label
			n.URL = l.me.URL
			n.IsParent = l.me.IsParent
			n.ParentURL = l.me.ParentURL
			n.Status = l.me.Status
		}
		byURL[cell.NormalizeURL(n.URL)] = n
		all = append(all, n)
	}

	for _, l := range lives {
		if l.err != nil || !l.me.IsParent {
			continue
		}
		children, err := a.fetchChildren(ctx, l.ref.URL)
		if err != nil {
			continue
		}
		for _, ch := range children {
			if node, ok := byURL[cell.NormalizeURL(ch.ChildURL)]; ok {
				node.Alive = ch.Alive
			}
		}
	}

	for _, n := range all {
		if !n.Reachable {
			unjoined = append(unjoined, n)
			continue
		}
		if n.ParentURL == "" {
			if n.IsParent || n.Status == "root" {
				roots = append(roots, n)
			} else {
				unjoined = append(unjoined, n)
			}
			continue
		}
		pURL := cell.NormalizeURL(n.ParentURL)
		if parent, ok := byURL[pURL]; ok {
			parent.Children = append(parent.Children, n)
		} else {
			roots = append(roots, n)
		}
	}
	sortNodes(roots)
	sortNodes(unjoined)
	for _, n := range all {
		sortNodes(n.Children)
	}
	return roots, unjoined
}

func (a *App) buildProjectTree(ctx context.Context) []*projectNode {
	labelByURL := map[string]string{}
	for _, c := range a.Cells {
		labelByURL[cell.NormalizeURL(c.URL)] = c.Label
	}
	byID := map[string]*projectNode{}
	var all []*projectNode
	for _, c := range a.Cells {
		projects, err := a.Peer.ListProjects(ctx, c.URL)
		if err != nil {
			continue
		}
		for _, p := range projects {
			host := p.HostCellURL
			if host == "" {
				host = c.URL
			}
			n := &projectNode{
				ID:            p.ID,
				Name:          p.Name,
				HostCellURL:   host,
				HostLabel:     labelByURL[cell.NormalizeURL(host)],
				IsParent:      p.IsParent,
				LookupEnabled: p.LookupEnabled,
				ParentID:      p.ParentProjectID,
			}
			byID[p.ID] = n
			all = append(all, n)
		}
	}
	var roots []*projectNode
	for _, n := range all {
		if n.ParentID == "" {
			roots = append(roots, n)
			continue
		}
		if parent, ok := byID[n.ParentID]; ok {
			parent.Children = append(parent.Children, n)
		} else {
			roots = append(roots, n)
		}
	}
	sortProjectNodes(roots)
	for _, n := range all {
		sortProjectNodes(n.Children)
	}
	return roots
}

func sortNodes(nodes []*snapshotNode) {
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Label < nodes[j].Label })
}

func sortProjectNodes(nodes []*projectNode) {
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Name < nodes[j].Name })
}

func (a *App) fetchChildren(ctx context.Context, baseURL string) ([]childRow, error) {
	type resp struct {
		Children []childRow `json:"children"`
	}
	var out resp
	err := a.Peer.DoRaw(ctx, http.MethodGet, cell.NormalizeURL(baseURL)+"/v1/children", nil, "", &out)
	return out.Children, err
}

func (a *App) render(w http.ResponseWriter, name string, data pageData) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := a.tmpl.ExecuteTemplate(w, name, data); err != nil {
		a.Log.Printf("template %s: %v", name, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func ParseCellsEnv(raw string) ([]CellRef, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("CELLS env is empty")
	}
	var out []CellRef
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		label, u, ok := strings.Cut(part, "=")
		if !ok || label == "" || u == "" {
			return nil, fmt.Errorf("invalid CELLS entry %q", part)
		}
		out = append(out, CellRef{Label: strings.TrimSpace(label), URL: strings.TrimSpace(u)})
	}
	return out, nil
}
