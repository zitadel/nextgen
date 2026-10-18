package ui

import (
	"context"
	"embed"
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

	traceMu sync.Mutex
	trace   []traceEntry
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
	usHost, err := a.cellURLByLabel("us")
	if err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	// Ensure chat app exists (idempotent for re-runs).
	apps, err := a.Peer.ListApps(ctx, usHost, "us")
	if err != nil {
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
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
			http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
			return
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
		http.Redirect(w, r, "/scenarios?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.appendTrace(note, out.Trace, "tuple="+out.Tuple.ID+" home="+out.Tuple.HomeProjectID)
	http.Redirect(w, r, "/scenarios?ok="+url.QueryEscape("granted joe viewer on us/chat"), http.StatusSeeOther)
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
