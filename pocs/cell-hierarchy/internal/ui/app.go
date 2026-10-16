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

type pageData struct {
	Title     string
	Flash     string
	FlashErr  string
	Tree      []*snapshotNode
	Unjoined  []*snapshotNode
	Parents   []CellRef
	UnjoinedO []CellRef
	Detail    *cellDetail
	Now       string
}

type cellDetail struct {
	Me       cell.MeResponse
	Children []childRow
	Error    string
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
		Title:    "Cell tree",
		Tree:     tree,
		Unjoined: unjoined,
		Now:      time.Now().UTC().Format(time.RFC3339),
	})
}

func (a *App) handleTree(w http.ResponseWriter, r *http.Request) {
	tree, unjoined := a.buildTree(r.Context())
	a.render(w, "tree", pageData{
		Tree:     tree,
		Unjoined: unjoined,
		Now:      time.Now().UTC().Format(time.RFC3339),
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
	}
	a.render(w, "detail", pageData{Title: "Cell " + label, Detail: detail})
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

func sortNodes(nodes []*snapshotNode) {
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Label < nodes[j].Label })
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
