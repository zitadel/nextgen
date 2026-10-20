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

	traceMu     sync.Mutex
	trace       []traceEntry
	traceAction string
	traceBuf    []cell.TraceHop

	delayMu    sync.Mutex
	delayPairs map[string]int

	wsMu          sync.Mutex
	workspaces    map[string]Workspace
	workspaceFile string

	signInMu sync.Mutex
	signIn   *signInResult

	globalLoginMu sync.Mutex
	globalLogin   *globalLoginResult

	groupCheckMu sync.Mutex
	groupCheck   *groupCheckResult

	lifecycleMu sync.Mutex
	lifecycle   *lifecycleResult
}

type traceEntry struct {
	At     string
	Action string
	Hops   []cell.TraceHop
	Note   string
}

type crumb struct {
	Label string
	Href  string
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
	a := &App{Cells: cells, Peer: cell.NewPeerClient(), Log: logger, tmpl: tmpl}
	a.Peer.OnHop = a.onHop
	a.seedDefaultDelays()
	a.seedWorkspaces()
	// Best-effort: push fixed delay matrix to cells once they are reachable.
	go a.broadcastDefaultDelaysSoon()
	return a, nil
}

// labObserveHint appends where to look after a Lab mutation.
func labObserveHint(projectID string) string {
	if projectID == "" {
		projectID = "acme-fra"
	}
	return " · Trace drawer /trace-view · observe /projects/" + projectID
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", a.handleHome)
	mux.HandleFunc("GET /tree", a.handleTree)
	// Delay editor removed from UI; handler kept for tests / manual POST.
	mux.HandleFunc("POST /cells/delays", a.handleCellsDelays)

	mux.HandleFunc("GET /workspaces", a.handleWorkspacesList)
	mux.HandleFunc("POST /workspaces", a.handleWorkspaceCreate)
	mux.HandleFunc("GET /workspaces/{id}", a.handleWorkspaceHome)
	mux.HandleFunc("POST /workspaces/{id}/sites", a.handleWorkspaceAddSite)

	mux.HandleFunc("GET /join", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/", http.StatusSeeOther)
	})
	mux.HandleFunc("POST /join", a.handleJoinSubmit)

	mux.HandleFunc("GET /create", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/workspaces", http.StatusSeeOther)
	})
	// Legacy create/expand POST handlers retained for scripts/tests; not linked in UI.
	mux.HandleFunc("POST /create/site", a.handleCreateSiteLegacy)
	mux.HandleFunc("POST /create/expand", a.handleExpandSite)
	mux.HandleFunc("POST /create/project", a.handleCreateProject)
	mux.HandleFunc("POST /create/team", a.handleCreateTeam)
	mux.HandleFunc("POST /create/app", a.handleCreateAppForm)

	mux.HandleFunc("GET /cells/{label}", a.handleCellDetail)
	mux.HandleFunc("GET /projects/{id}", a.handleProjectDetail)
	// Project page is observe-only — no mutation POST routes.

	mux.HandleFunc("GET /lab", a.handleScenarios)
	mux.HandleFunc("GET /scenarios", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/lab", http.StatusSeeOther)
	})
	mux.HandleFunc("POST /scenarios/create-user", a.handleScenarioCreateUser)
	mux.HandleFunc("POST /scenarios/lookup", a.handleScenarioLookup)
	mux.HandleFunc("POST /scenarios/grant-joe", a.handleScenarioGrantJoe)
	mux.HandleFunc("POST /scenarios/sign-in-joe", a.handleScenarioSignInJoe)
	mux.HandleFunc("POST /scenarios/seed-group-chain", a.handleScenarioSeedGroupChain)
	mux.HandleFunc("POST /scenarios/group-check-joe", a.handleScenarioGroupCheckJoe)
	mux.HandleFunc("POST /scenarios/block-joe", a.handleScenarioBlockJoe)
	mux.HandleFunc("POST /scenarios/delete-joe", a.handleScenarioDeleteJoe)
	mux.HandleFunc("POST /scenarios/global-login", a.handleScenarioGlobalLogin)
	// Lab aliases
	mux.HandleFunc("POST /lab/create-user", a.handleScenarioCreateUser)
	mux.HandleFunc("POST /lab/lookup", a.handleScenarioLookup)
	mux.HandleFunc("POST /lab/grant-joe", a.handleScenarioGrantJoe)
	mux.HandleFunc("POST /lab/sign-in-joe", a.handleScenarioSignInJoe)
	mux.HandleFunc("POST /lab/seed-group-chain", a.handleScenarioSeedGroupChain)
	mux.HandleFunc("POST /lab/group-check-joe", a.handleScenarioGroupCheckJoe)
	mux.HandleFunc("POST /lab/block-joe", a.handleScenarioBlockJoe)
	mux.HandleFunc("POST /lab/delete-joe", a.handleScenarioDeleteJoe)
	mux.HandleFunc("POST /lab/global-login", a.handleScenarioGlobalLogin)

	mux.HandleFunc("GET /trace", a.handleTracePartial)
	mux.HandleFunc("GET /trace-view", a.handleTracePage)
	mux.HandleFunc("GET /trace-page", a.handleTracePage)
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
	Title          string
	NavActive      string
	Breadcrumbs    []crumb
	ShowTracePanel bool
	Flash          string
	FlashErr       string
	Tree           []*snapshotNode
	Unjoined       []*snapshotNode
	ProjectTree    []*projectNode
	Parents        []CellRef
	UnjoinedO      []CellRef
	Cells          []CellRef
	Detail         *cellDetail
	Project        *projectDetail
	Trace          []traceEntry
	Now            string
	ScenarioOK     string
	ScenarioErr    string
	SignIn         *signInResult
	GlobalLogin    *globalLoginResult
	GroupCheck     *groupCheckResult
	Lifecycle      *lifecycleResult
	Workspaces     []string
	WorkspaceList  []Workspace
	Workspace      *Workspace
	Sites          []siteSummary
	CellMeta       map[string]string
	DelayPairs     []delayPairView
}

type lifecycleResult struct {
	Action                  string
	Epoch                   int
	Blocked                 bool
	Deleted                 bool
	OnlineAllowed           bool
	OnlineReason            string
	OfflineAllowed          bool
	OfflineReason           string
	Token                   string
	USTuplesBefore          int // active before
	USTuplesAfter           int // active after (compat)
	USTuplesActiveAfter     int
	USTuplesTombstonedAfter int
	TombstonedSubjects      []string
	InterestsBefore         int
	InterestsNotified       []string
	ResourceCell            string
	ResourceProject         string
	GroupAllowed            *bool
	GroupReason             string
	LookupHit               bool
	LookupState             string
	Note                    string
	Hops                    []cell.TraceHop
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

type globalLoginResult struct {
	Email       string
	Hit         bool
	HomeProject string
	HomeCell    string
	IssuerHint  string
	FoundAt     string
	Token       string
	ClaimsJSON  string
	AuthAllowed bool
	AuthReason  string
	Note        string
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
	FlashOK   string
	FlashErr  string
	Error     string
}

type userRow struct {
	ID                   string  `json:"id"`
	ProjectID            string  `json:"project_id"`
	Email                string  `json:"email"`
	Epoch                int     `json:"epoch"`
	Blocked              bool    `json:"blocked"`
	DeletedAt            *string `json:"deleted_at,omitempty"`
	LifecycleOwnerTeamID string  `json:"lifecycle_owner_team_id,omitempty"`
	CreatedAt            string  `json:"created_at"`
}

type lookupRow struct {
	Key           string `json:"key"`
	HomeProjectID string `json:"home_project_id"`
	HomeCellURL   string `json:"home_cell_url"`
	State         string `json:"state"`
	Source        string `json:"source"`
	ViaProject    string `json:"via_project"`
	UpdatedAt     string `json:"updated_at"`
}

type childRow struct {
	ChildURL   string `json:"child_url"`
	Label      string `json:"label"`
	Alive      bool   `json:"alive"`
	LastSeenAt string `json:"last_seen_at"`
}

func (a *App) handleHome(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tree, unjoined := a.buildTree(ctx)
	sites := a.listSites(ctx)
	a.ensureWorkspaceFromSites(sites)
	parents, unjoinedOpts := a.joinOptions(ctx)
	a.render(w, "home", pageData{
		Title:          "Cells",
		NavActive:      "cells",
		ShowTracePanel: true,
		Tree:           tree,
		Unjoined:       unjoined,
		ProjectTree:    a.buildProjectTree(ctx),
		Parents:        parents,
		UnjoinedO:      unjoinedOpts,
		Trace:          a.copyTrace(),
		Now:            time.Now().UTC().Format(time.RFC3339),
		Workspaces:     a.listWorkspaceIDs(sites),
		Sites:          sites,
		DelayPairs:     a.delayPairViews(),
		Flash:          r.URL.Query().Get("ok"),
		FlashErr:       r.URL.Query().Get("err"),
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

func (a *App) handleJoinSubmit(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	parentURL := r.FormValue("parent_url")
	childURL := r.FormValue("child_url")
	if parentURL == "" || childURL == "" {
		http.Redirect(w, r, "/?err="+url.QueryEscape("parent and child required"), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	a.beginTrace("join cell")
	invite, err := a.Peer.Prepare(ctx, parentURL)
	if err != nil {
		a.endTrace(err.Error(), nil)
		http.Redirect(w, r, "/?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	_, err = a.Peer.Accept(ctx, childURL, cell.AcceptRequest{
		ParentURL: invite.ParentURL,
		JoinToken: invite.JoinToken,
	})
	if err != nil {
		a.endTrace(err.Error(), nil)
		http.Redirect(w, r, "/?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.endTrace("joined successfully", nil)
	http.Redirect(w, r, "/?ok="+url.QueryEscape("joined successfully"), http.StatusSeeOther)
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
	a.render(w, "detail", pageData{
		Title: "Cell " + label, NavActive: "cells", Detail: detail,
		ShowTracePanel: true, Trace: a.copyTrace(),
	})
}

func (a *App) handleProjectDetail(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	detail := &projectDetail{
		FlashOK:  r.URL.Query().Get("ok"),
		FlashErr: r.URL.Query().Get("err"),
	}
	hostURL, proj, err := a.findProject(ctx, id)
	if err != nil {
		detail.Error = err.Error()
		a.render(w, "project", pageData{
			Title: "Project " + id, NavActive: "workspaces", Project: detail,
			ShowTracePanel: true, Trace: a.copyTrace(),
			Breadcrumbs: []crumb{{Label: "Workspaces", Href: "/workspaces"}, {Label: id}},
		})
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
	crumbs := []crumb{{Label: "Workspaces", Href: "/workspaces"}}
	if proj.WorkspaceID != "" {
		crumbs = append(crumbs,
			crumb{Label: proj.WorkspaceID, Href: "/workspaces/" + url.PathEscape(proj.WorkspaceID)},
			crumb{Label: id},
		)
	} else {
		crumbs = append(crumbs, crumb{Label: id})
	}
	a.render(w, "project", pageData{
		Title: "Project " + id, NavActive: "workspaces", Project: detail,
		Breadcrumbs: crumbs, ShowTracePanel: true, Trace: a.copyTrace(),
	})
}

func (a *App) handleScenarios(w http.ResponseWriter, r *http.Request) {
	a.render(w, "scenarios", pageData{
		Title:          "Lab",
		NavActive:      "lab",
		ShowTracePanel: true,
		Cells:          a.Cells,
		Trace:          a.copyTrace(),
		ScenarioOK:     r.URL.Query().Get("ok"),
		ScenarioErr:    r.URL.Query().Get("err"),
		SignIn:         a.copySignIn(),
		GlobalLogin:    a.copyGlobalLogin(),
		GroupCheck:     a.copyGroupCheck(),
		Lifecycle:      a.copyLifecycle(),
	})
}

func (a *App) finishTraceSession() {
	a.traceMu.Lock()
	defer a.traceMu.Unlock()
	a.traceAction = ""
	a.traceBuf = nil
}

func (a *App) handleScenarioCreateUser(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	email := strings.TrimSpace(r.FormValue("email"))
	if email == "" {
		email = fmt.Sprintf("demo-%d@example.com", time.Now().Unix()%100000)
	}
	deferFloat := r.FormValue("defer_float") == "1"
	entryCell := a.parseEntryCell(r.FormValue("entry_cell"), "eu-1")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	a.beginTrace("create user")
	defer a.finishTraceSession()
	host, projectID, err := a.projectOnCell(ctx, entryCell)
	if err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	out, err := a.Peer.CreateUser(ctx, host, projectID, email, deferFloat)
	note := "create " + email + " on " + projectID + "@" + entryCell
	if deferFloat {
		note += " (defer float)"
	}
	if err != nil {
		a.appendTrace(note, out.Trace, err.Error())
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.appendTrace(note, out.Trace, "created")
	http.Redirect(w, r, "/lab?ok="+url.QueryEscape("created "+email+" on "+projectID+labObserveHint(projectID)), http.StatusSeeOther)
}

func (a *App) handleScenarioLookup(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	key := strings.TrimSpace(r.FormValue("key"))
	if key == "" {
		key = "joe@example.com"
	}
	entryCell := a.parseEntryCell(r.FormValue("entry_cell"), "eu-1")
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	a.beginTrace("lookup walk")
	defer a.finishTraceSession()
	host, projectID, err := a.projectOnCell(ctx, entryCell)
	if err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	res, hops, err := a.Peer.LookupWalk(ctx, host, projectID, key)
	if err != nil {
		a.appendTrace("lookup walk from "+projectID+": "+key, hops, err.Error())
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	note := "miss"
	if res.Hit {
		note = "hit home=" + res.HomeProjectID + " at=" + res.FoundAtProjectID
	}
	a.appendTrace("lookup walk from "+projectID+": "+key, hops, note)
	http.Redirect(w, r, "/lab?ok="+url.QueryEscape(note+labObserveHint(projectID)), http.StatusSeeOther)
}

func (a *App) handleScenarioGrantJoe(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	entryCell := a.parseEntryCell(r.FormValue("entry_cell"), "eu-1")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	a.beginTrace("grant joe")
	defer a.finishTraceSession()
	host, projectID, err := a.projectOnCell(ctx, entryCell)
	if err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	if _, err := a.ensureJoeGrantOn(ctx, host, projectID); err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/lab?ok="+url.QueryEscape("granted joe viewer on "+projectID+"/chat"+labObserveHint(projectID)), http.StatusSeeOther)
}

func (a *App) handleScenarioSignInJoe(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	a.beginTrace("sign-in joe")
	defer a.finishTraceSession()
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	autoGrant := r.FormValue("auto_grant") == "1"
	entryCell := a.parseEntryCell(r.FormValue("entry_cell"), "eu-1")

	resourceHost, resourceProject, err := a.projectOnCell(ctx, entryCell)
	if err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	key := "joe@example.com"
	var allHops []cell.TraceHop

	// 1) Lookup walk from resource project → Joe's home.
	res, hops, err := a.Peer.LookupWalk(ctx, resourceHost, resourceProject, key)
	allHops = append(allHops, hops...)
	if err != nil {
		a.appendTrace("sign-in joe: lookup", allHops, err.Error())
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	if !res.Hit {
		a.appendTrace("sign-in joe: lookup", allHops, "miss — run grant / seed float first")
		http.Redirect(w, r, "/lab?err="+url.QueryEscape("lookup miss for joe@example.com from "+resourceProject), http.StatusSeeOther)
		return
	}
	a.appendTrace("sign-in joe: lookup", hops, "hit home="+res.HomeProjectID+" cell="+res.HomeCellURL)

	// 2) Optionally ensure grant exists on the resource project before auth check.
	autoGranted := false
	tuples, err := a.Peer.ListTuples(ctx, resourceHost, resourceProject)
	if err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	hasGrant := false
	for _, tup := range tuples {
		if tup.Tombstoned {
			continue
		}
		if tup.Object == "app:chat" && tup.Relation == "viewer" && tup.UserKey == key {
			hasGrant = true
			break
		}
	}
	if !hasGrant {
		if !autoGrant {
			a.appendTrace("sign-in joe: grant", nil, "missing — run grant scenario first")
			http.Redirect(w, r, "/lab?err="+url.QueryEscape("no grant for joe on "+resourceProject+"/chat — run Grant Joe or enable auto-grant"), http.StatusSeeOther)
			return
		}
		if _, err := a.ensureJoeGrantOn(ctx, resourceHost, resourceProject); err != nil {
			http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
			return
		}
		autoGranted = true
	}

	// 3) Issue token at Joe's home (acme-fra @ eu-1).
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
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
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

	// 4) Auth check on selected resource cell — offline then online.
	offline, err := a.Peer.AuthCheck(ctx, resourceHost, cell.AuthCheckRequest{
		Token: issued.Token, ProjectID: resourceProject, Object: "app:chat", Relation: "viewer", Online: false,
	})
	if err != nil {
		a.appendTrace("sign-in joe: auth offline", offline.Trace, err.Error())
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	result.AllowedOffline = offline.Allowed
	result.ReasonOffline = offline.Reason
	a.appendTrace("sign-in joe: auth offline", offline.Trace, offline.Reason)

	online, err := a.Peer.AuthCheck(ctx, resourceHost, cell.AuthCheckRequest{
		Token: issued.Token, ProjectID: resourceProject, Object: "app:chat", Relation: "viewer", Online: true,
	})
	if err != nil {
		a.appendTrace("sign-in joe: auth online", online.Trace, err.Error())
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	result.AllowedOnline = online.Allowed
	result.ReasonOnline = online.Reason
	a.appendTrace("sign-in joe: auth online", online.Trace, online.Reason)

	a.setSignIn(result)
	msg := "signed in joe · auth on " + resourceProject
	if autoGranted {
		msg += " (auto-granted)"
	}
	if !online.Allowed {
		msg += " — denied: " + online.Reason
	}
	http.Redirect(w, r, "/lab?ok="+url.QueryEscape(msg+labObserveHint(resourceProject)), http.StatusSeeOther)
}

func (a *App) handleScenarioSeedGroupChain(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	a.beginTrace("seed group chain")
	defer a.finishTraceSession()
	if err := a.ensureGroupChain(ctx); err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/lab?ok="+url.QueryEscape("seeded group chain A→B→chat"), http.StatusSeeOther)
}

func (a *App) handleScenarioGroupCheckJoe(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	a.beginTrace("group check joe")
	defer a.finishTraceSession()
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	entryCell := a.parseEntryCell(r.FormValue("entry_cell"), "eu-1")
	autoSeed := r.FormValue("auto_seed") == "1"

	host, projectID, err := a.projectOnCell(ctx, entryCell)
	if err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}

	seeded := false
	if autoSeed {
		if err := a.ensureGroupChain(ctx); err != nil {
			http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
			return
		}
		seeded = true
	}

	res, err := a.Peer.FGACheck(ctx, host, cell.FGACheckRequest{
		ProjectID: projectID,
		Object:    "app:chat",
		Relation:  "viewer",
		UserKey:   "joe@example.com",
		DelayMs:   nil,
	})
	if err != nil {
		a.appendTrace("group check joe → app:chat@"+projectID, res.Trace, err.Error())
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	note := fmt.Sprintf("allowed=%v total_ms=%d cross_cell_hops=%d delay_ms=%d entry=%s",
		res.Allowed, res.TotalMs, res.CrossCellHops, 0, entryCell)
	a.appendTrace("group check joe → app:chat@"+projectID, res.Trace, note)

	result := &groupCheckResult{
		Allowed:       res.Allowed,
		Reason:        res.Reason,
		DelayMs:       0,
		TotalMs:       res.TotalMs,
		CrossCellHops: res.CrossCellHops,
		Hops:          res.Trace,
		Seeded:        seeded,
		Note:          "Compare with Phase 3/4 flattened direct grant (app:chat#viewer@user:joe) — one local hop, no cross-cell expand. Pairwise delays apply on cross-cell peer hops.",
	}
	a.setGroupCheck(result)

	msg := fmt.Sprintf("group check @%s: %s · %dms · %d cross-cell hops", projectID, res.Reason, res.TotalMs, res.CrossCellHops)
	msg += labObserveHint(projectID)
	if !res.Allowed {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(msg), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/lab?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}

func (a *App) ensureGroupChain(ctx context.Context) error {
	platformHost, err := a.cellURLByLabel("platform")
	if err != nil {
		return err
	}
	eu1Host, err := a.cellURLByLabel("eu-1")
	if err != nil {
		return err
	}

	apps, err := a.Peer.ListApps(ctx, eu1Host, "acme-fra")
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
		if _, err := a.Peer.CreateApp(ctx, eu1Host, "acme-fra", map[string]any{"name": "chat"}); err != nil {
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
			cellURL: eu1Host, projectID: "acme-fra", label: "group:A#member@user:joe",
			body: map[string]any{
				"object": "group:A", "relation": "member", "user_key": "joe@example.com",
				"subject_kind": "user", "home_project_id": "acme-fra", "home_cell_url": eu1Host,
				"skip_interest": true,
			},
		},
		{
			cellURL: platformHost, projectID: "platform", label: "group:B#member@group:A@acme-fra",
			body: map[string]any{
				"object": "group:B", "relation": "member",
				"subject_kind": "group", "user_key": "A",
				"home_project_id": "acme-fra", "home_cell_url": eu1Host,
			},
		},
		{
			cellURL: eu1Host, projectID: "acme-fra", label: "app:chat#viewer@group:B@platform",
			body: map[string]any{
				"object": "app:chat", "relation": "viewer",
				"subject_kind": "group", "user_key": "B",
				"home_project_id": "platform", "home_cell_url": platformHost,
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
			if tup.Tombstoned {
				continue
			}
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

func (a *App) handleScenarioBlockJoe(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	entryCell := a.parseEntryCell(r.FormValue("entry_cell"), "eu-1")
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	a.beginTrace("block joe")
	defer a.finishTraceSession()
	result, err := a.runLifecycleScenario(ctx, "block", entryCell)
	if err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.setLifecycle(result)
	msg := fmt.Sprintf("blocked joe · epoch=%d · online=%v (%s) · offline=%v (%s)",
		result.Epoch, result.OnlineAllowed, result.OnlineReason, result.OfflineAllowed, result.OfflineReason)
	http.Redirect(w, r, "/lab?ok="+url.QueryEscape(msg+labObserveHint(result.ResourceProject)), http.StatusSeeOther)
}

func (a *App) handleScenarioDeleteJoe(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	entryCell := a.parseEntryCell(r.FormValue("entry_cell"), "eu-1")
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	a.beginTrace("delete joe")
	defer a.finishTraceSession()
	result, err := a.runLifecycleScenario(ctx, "delete", entryCell)
	if err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.setLifecycle(result)
	msg := fmt.Sprintf("deleted joe · %s tuples active %d→%d (tombstoned %d) · interests notified=%d · lookup=%s",
		result.ResourceProject, result.USTuplesBefore, result.USTuplesActiveAfter,
		result.USTuplesTombstonedAfter, len(result.InterestsNotified), result.LookupState)
	http.Redirect(w, r, "/lab?ok="+url.QueryEscape(msg+labObserveHint(result.ResourceProject)), http.StatusSeeOther)
}

func (a *App) runLifecycleScenario(ctx context.Context, action, resourceCellLabel string) (*lifecycleResult, error) {
	homeHost, err := a.cellURLByLabel("eu-1")
	if err != nil {
		return nil, err
	}
	homeProject := "acme-fra"
	resourceHost, resourceProject, err := a.projectOnCell(ctx, resourceCellLabel)
	if err != nil {
		return nil, err
	}
	key := "joe@example.com"

	if err := a.ensureJoeAlive(ctx, action); err != nil {
		return nil, err
	}
	if _, err := a.ensureJoeGrantOn(ctx, resourceHost, resourceProject); err != nil {
		return nil, err
	}
	if err := a.ensureGroupChain(ctx); err != nil {
		return nil, err
	}

	interestsBefore, err := a.Peer.ListInterests(ctx, homeHost, homeProject)
	if err != nil {
		return nil, err
	}
	joeInterestCount := 0
	for _, i := range interestsBefore {
		if i.PrincipalKey == key {
			joeInterestCount++
		}
	}

	tuplesBefore, err := a.Peer.ListTuples(ctx, resourceHost, resourceProject)
	if err != nil {
		return nil, err
	}
	joeBefore := countActiveJoeTuples(tuplesBefore)

	var hops []cell.TraceHop
	result := &lifecycleResult{
		Action:          action,
		USTuplesBefore:  joeBefore,
		InterestsBefore: joeInterestCount,
		ResourceCell:    resourceCellLabel,
		ResourceProject: resourceProject,
		Note: "Online auth/check fails immediately after block (epoch/blocked). " +
			"Offline (online=false) still allows until JWT exp (~60s). " +
			"Delete fans out user.deleted only to interest subscribers; subscribers tombstone grants (rows remain visible). " +
			"Home tombstones local user-subject tuples so FGA expand misses Joe. " +
			"If home is stopped, event push errors (fail-closed) and online principal/check also fails closed.",
	}

	var token string
	issued, err := a.Peer.IssueToken(ctx, homeHost, cell.IssueTokenRequest{
		ProjectID: homeProject, Sub: key, Aud: "app:chat",
	})
	if err != nil {
		a.appendTrace("lifecycle: issue before "+action, nil, err.Error())
		result.OfflineReason = "no_token:" + err.Error()
		result.OnlineReason = "no_token:" + err.Error()
	} else {
		token = issued.Token
		result.Token = token
		a.appendTrace("lifecycle: issue before "+action, nil, fmt.Sprintf("epoch=%d exp=%d", issued.Claims.Epoch, issued.Claims.Exp))
	}

	switch action {
	case "block":
		out, err := a.Peer.BlockUser(ctx, homeHost, homeProject, key)
		hops = out.Trace
		if err != nil {
			a.appendTrace("block joe", hops, err.Error())
			return nil, err
		}
		result.Epoch = out.User.Epoch
		result.Blocked = out.User.Blocked
		a.appendTrace("block joe", hops, fmt.Sprintf("epoch=%d blocked=%v", out.User.Epoch, out.User.Blocked))
	case "delete":
		out, err := a.Peer.DeleteUser(ctx, homeHost, homeProject, key)
		hops = out.Trace
		if err != nil {
			a.appendTrace("delete joe", hops, err.Error())
			return nil, err
		}
		result.Epoch = out.User.Epoch
		result.Blocked = out.User.Blocked
		result.Deleted = out.User.DeletedAt != nil
		a.appendTrace("delete joe", hops, fmt.Sprintf("epoch=%d deleted=%v", out.User.Epoch, result.Deleted))
	default:
		return nil, fmt.Errorf("unknown action %q", action)
	}
	result.Hops = hops
	result.InterestsNotified = interestsFromDeleteTrace(hops)

	if token != "" {
		offline, err := a.Peer.AuthCheck(ctx, resourceHost, cell.AuthCheckRequest{
			Token: token, ProjectID: resourceProject, Object: "app:chat", Relation: "viewer", Online: false,
		})
		if err != nil {
			return nil, err
		}
		result.OfflineAllowed = offline.Allowed
		result.OfflineReason = offline.Reason
		a.appendTrace("lifecycle: auth offline after "+action, offline.Trace, offline.Reason)

		online, err := a.Peer.AuthCheck(ctx, resourceHost, cell.AuthCheckRequest{
			Token: token, ProjectID: resourceProject, Object: "app:chat", Relation: "viewer", Online: true,
		})
		if err != nil {
			return nil, err
		}
		result.OnlineAllowed = online.Allowed
		result.OnlineReason = online.Reason
		a.appendTrace("lifecycle: auth online after "+action, online.Trace, online.Reason)
	}

	tuplesAfter, err := a.Peer.ListTuples(ctx, resourceHost, resourceProject)
	if err != nil {
		return nil, err
	}
	result.USTuplesActiveAfter = countActiveJoeTuples(tuplesAfter)
	result.USTuplesTombstonedAfter = countTombstonedJoeTuples(tuplesAfter)
	result.USTuplesAfter = result.USTuplesActiveAfter
	result.TombstonedSubjects = joeTombstonedSubjects(tuplesAfter)

	if action == "delete" {
		group, err := a.Peer.FGACheck(ctx, resourceHost, cell.FGACheckRequest{
			ProjectID: resourceProject, Object: "app:chat", Relation: "viewer", UserKey: key,
		})
		if err != nil {
			return nil, err
		}
		allowed := group.Allowed
		result.GroupAllowed = &allowed
		result.GroupReason = group.Reason
		a.appendTrace("lifecycle: group check after delete", group.Trace, group.Reason)

		look, lookHops, err := a.Peer.LookupWalk(ctx, resourceHost, resourceProject, key)
		if err != nil {
			return nil, err
		}
		result.LookupHit = look.Hit
		if look.Tombstoned {
			result.LookupState = "tombstone"
		} else if look.Hit {
			result.LookupState = "hit:" + look.State
		} else {
			result.LookupState = "miss"
		}
		a.appendTrace("lifecycle: lookup after delete", lookHops, result.LookupState)
	}
	return result, nil
}

// ensureJoeAlive recreates joe@example.com on acme-fra when missing.
// After delete the home row stays as a tombstone — re-bootstrap to demo again.
func (a *App) ensureJoeAlive(ctx context.Context, action string) error {
	homeHost, err := a.cellURLByLabel("eu-1")
	if err != nil {
		return err
	}
	homeProject := "acme-fra"
	var raw struct {
		Users []userRow `json:"users"`
	}
	if err := a.Peer.DoRaw(ctx, http.MethodGet, cell.NormalizeURL(homeHost)+"/v1/projects/"+homeProject, nil, "", &raw); err != nil {
		return err
	}
	for _, u := range raw.Users {
		if u.Email == "joe@example.com" {
			if u.DeletedAt != nil {
				return fmt.Errorf("joe is deleted (tombstone) — re-run ./scripts/run-local.sh to demo again")
			}
			if action == "block" && u.Blocked {
				return fmt.Errorf("joe is already blocked — delete joe or re-bootstrap before a fresh block demo")
			}
			return nil
		}
	}
	out, err := a.Peer.CreateUser(ctx, homeHost, homeProject, "joe@example.com", false)
	if err != nil {
		a.appendTrace("recreate joe", out.Trace, err.Error())
		return err
	}
	a.appendTrace("recreate joe", out.Trace, "created")
	return nil
}

func (a *App) handleScenarioGlobalLogin(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	email := strings.TrimSpace(r.FormValue("email"))
	if email == "" {
		email = "joe@example.com"
	}
	issueToken := r.FormValue("issue_token") == "1"
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	a.beginTrace("global login")
	defer a.finishTraceSession()

	platformHost, err := a.cellURLByLabel("platform")
	if err != nil {
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	res, hops, err := a.Peer.LookupWalk(ctx, platformHost, "platform", email)
	if err != nil {
		a.appendTrace("global login: lookup", hops, err.Error())
		http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	result := &globalLoginResult{
		Email: email,
		Hit:   res.Hit,
		Note:  "Lookup starts at platform project (global entry). Redirect target is home_project + home_cell.",
	}
	if !res.Hit {
		a.appendTrace("global login: lookup", hops, "miss")
		a.setGlobalLogin(result)
		http.Redirect(w, r, "/lab?err="+url.QueryEscape("global login miss for "+email), http.StatusSeeOther)
		return
	}
	result.HomeProject = res.HomeProjectID
	result.HomeCell = res.HomeCellURL
	result.FoundAt = res.FoundAtProjectID
	result.IssuerHint = res.HomeCellURL
	a.appendTrace("global login: lookup", hops, "hit home="+res.HomeProjectID+" cell="+res.HomeCellURL)

	if issueToken {
		issued, err := a.Peer.IssueToken(ctx, res.HomeCellURL, cell.IssueTokenRequest{
			ProjectID: res.HomeProjectID, Sub: email, Aud: "app:chat",
		})
		if err != nil {
			a.appendTrace("global login: issue", nil, err.Error())
			http.Redirect(w, r, "/lab?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
			return
		}
		claimsJSON, _ := json.MarshalIndent(issued.Claims, "", "  ")
		result.Token = issued.Token
		result.ClaimsJSON = string(claimsJSON)
		auth, err := a.Peer.AuthCheck(ctx, res.HomeCellURL, cell.AuthCheckRequest{
			Token: issued.Token, ProjectID: res.HomeProjectID, Object: "app:chat", Relation: "viewer", Online: true,
		})
		if err != nil {
			// Ensure grant then retry once.
			if _, gerr := a.ensureJoeGrantOn(ctx, res.HomeCellURL, res.HomeProjectID); gerr == nil {
				auth, err = a.Peer.AuthCheck(ctx, res.HomeCellURL, cell.AuthCheckRequest{
					Token: issued.Token, ProjectID: res.HomeProjectID, Object: "app:chat", Relation: "viewer", Online: true,
				})
			}
		}
		if err != nil {
			a.appendTrace("global login: auth", nil, err.Error())
		} else {
			result.AuthAllowed = auth.Allowed
			result.AuthReason = auth.Reason
			a.appendTrace("global login: auth on home chat", auth.Trace, auth.Reason)
		}
	}
	a.setGlobalLogin(result)
	msg := fmt.Sprintf("global login %s → %s @ %s", email, result.HomeProject, result.HomeCell)
	http.Redirect(w, r, "/lab?ok="+url.QueryEscape(msg+labObserveHint(result.HomeProject)), http.StatusSeeOther)
}

func (a *App) setGlobalLogin(gl *globalLoginResult) {
	a.globalLoginMu.Lock()
	defer a.globalLoginMu.Unlock()
	a.globalLogin = gl
}

func (a *App) copyGlobalLogin() *globalLoginResult {
	a.globalLoginMu.Lock()
	defer a.globalLoginMu.Unlock()
	if a.globalLogin == nil {
		return nil
	}
	cp := *a.globalLogin
	return &cp
}

func (a *App) setLifecycle(lr *lifecycleResult) {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	a.lifecycle = lr
}

func (a *App) copyLifecycle() *lifecycleResult {
	a.lifecycleMu.Lock()
	defer a.lifecycleMu.Unlock()
	if a.lifecycle == nil {
		return nil
	}
	cp := *a.lifecycle
	if a.lifecycle.Hops != nil {
		cp.Hops = make([]cell.TraceHop, len(a.lifecycle.Hops))
		copy(cp.Hops, a.lifecycle.Hops)
	}
	if a.lifecycle.TombstonedSubjects != nil {
		cp.TombstonedSubjects = append([]string(nil), a.lifecycle.TombstonedSubjects...)
	}
	if a.lifecycle.InterestsNotified != nil {
		cp.InterestsNotified = append([]string(nil), a.lifecycle.InterestsNotified...)
	}
	return &cp
}

func (a *App) ensureJoeGrant(ctx context.Context) (cell.CreateTupleResponse, error) {
	host, err := a.cellURLByLabel("eu-1")
	if err != nil {
		return cell.CreateTupleResponse{}, err
	}
	return a.ensureJoeGrantOn(ctx, host, "acme-fra")
}

func (a *App) ensureJoeGrantOn(ctx context.Context, hostURL, projectID string) (cell.CreateTupleResponse, error) {
	apps, err := a.Peer.ListApps(ctx, hostURL, projectID)
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
		if _, err := a.Peer.CreateApp(ctx, hostURL, projectID, map[string]any{"name": "chat"}); err != nil {
			return cell.CreateTupleResponse{}, err
		}
	}
	tuples, err := a.Peer.ListTuples(ctx, hostURL, projectID)
	if err != nil {
		return cell.CreateTupleResponse{}, err
	}
	for _, tup := range tuples {
		if tup.Tombstoned {
			continue
		}
		if tup.Object == "app:chat" && tup.Relation == "viewer" && tup.UserKey == "joe@example.com" {
			a.appendTrace("grant joe viewer on "+projectID+"/app:chat", nil, "already exists tuple="+tup.ID)
			return cell.CreateTupleResponse{Tuple: tup}, nil
		}
	}
	out, err := a.Peer.CreateTuple(ctx, hostURL, projectID, map[string]any{
		"object":   "app:chat",
		"relation": "viewer",
		"user_key": "joe@example.com",
	})
	note := "grant joe viewer on " + projectID + "/app:chat"
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

func (a *App) handleTracePartial(w http.ResponseWriter, r *http.Request) {
	a.render(w, "trace", pageData{Trace: a.copyTrace()})
}

func (a *App) handleTracePage(w http.ResponseWriter, r *http.Request) {
	a.render(w, "trace_page", pageData{
		Title:          "Global Trace",
		NavActive:      "trace",
		ShowTracePanel: true,
		Trace:          a.copyTrace(),
	})
}

func (a *App) handleTraceClear(w http.ResponseWriter, r *http.Request) {
	a.traceMu.Lock()
	a.trace = nil
	a.traceAction = ""
	a.traceBuf = nil
	a.traceMu.Unlock()
	ref := r.Header.Get("Referer")
	if strings.Contains(ref, "/lab") {
		http.Redirect(w, r, "/lab", http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/trace-view", http.StatusSeeOther)
}

func (a *App) beginTrace(action string) {
	a.traceMu.Lock()
	defer a.traceMu.Unlock()
	a.traceAction = action
	a.traceBuf = nil
}

func (a *App) onHop(hop cell.TraceHop) {
	a.traceMu.Lock()
	defer a.traceMu.Unlock()
	if a.traceAction == "" {
		return
	}
	a.traceBuf = append(a.traceBuf, hop)
}

// endTrace finalizes the current action, merging OnHop buffer with optional server hops.
func (a *App) endTrace(note string, serverHops []cell.TraceHop) {
	a.traceMu.Lock()
	action := a.traceAction
	hops := append([]cell.TraceHop{}, a.traceBuf...)
	a.traceAction = ""
	a.traceBuf = nil
	a.traceMu.Unlock()
	if action == "" && len(hops) == 0 && len(serverHops) == 0 {
		return
	}
	if action == "" {
		action = "peer"
	}
	hops = append(hops, serverHops...)
	a.appendTraceEntry(action, hops, note)
}

func (a *App) appendTrace(action string, hops []cell.TraceHop, note string) {
	a.traceMu.Lock()
	buf := a.traceBuf
	a.traceBuf = nil
	if action == "" {
		action = a.traceAction
	}
	a.traceMu.Unlock()
	merged := append(append([]cell.TraceHop{}, buf...), hops...)
	a.appendTraceEntry(action, merged, note)
}

func (a *App) appendTraceEntry(action string, hops []cell.TraceHop, note string) {
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

func (a *App) render(w http.ResponseWriter, name string, data any) {
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
