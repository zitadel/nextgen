package ui

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func (a *App) handlePlatform(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	detail := &platformDetail{
		FlashOK:  r.URL.Query().Get("ok"),
		FlashErr: r.URL.Query().Get("err"),
	}
	platformHost, err := a.cellURLByLabel("platform")
	if err != nil {
		detail.Error = err.Error()
		a.render(w, "platform", pageData{
			Title: "Platform", NavActive: "platform",
			Breadcrumbs: []crumb{{Label: "Platform"}},
			Platform:    detail, LatestTrace: a.latestTrace(),
		})
		return
	}
	proj, err := a.Peer.GetProject(ctx, platformHost, "platform")
	if err != nil {
		detail.Error = err.Error()
	} else {
		detail.Project = &proj
		detail.HostURL = platformHost
	}
	teams, err := a.Peer.ListTeams(ctx, platformHost, "platform")
	if err != nil && detail.Error == "" {
		detail.Error = err.Error()
	} else {
		detail.Teams = teams
	}

	a.render(w, "platform", pageData{
		Title:       "Platform",
		NavActive:   "platform",
		Breadcrumbs: []crumb{{Label: "Platform"}},
		Platform:    detail,
		LatestTrace: a.latestTrace(),
	})
}

func (a *App) handlePlatformCreateTeam(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/platform?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	name := strings.TrimSpace(r.FormValue("name"))
	id := strings.TrimSpace(r.FormValue("id"))
	if name == "" {
		http.Redirect(w, r, "/platform?err="+url.QueryEscape("team name required"), http.StatusSeeOther)
		return
	}
	if id == "" {
		id = strings.ToLower(strings.ReplaceAll(name, " ", "-"))
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	platformHost, err := a.cellURLByLabel("platform")
	if err != nil {
		http.Redirect(w, r, "/platform?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.beginTrace("create team " + id)
	body := map[string]any{"id": id, "name": name}
	team, err := a.Peer.CreateTeam(ctx, platformHost, "platform", body)
	if err != nil {
		a.endTrace(err.Error(), nil)
		http.Redirect(w, r, "/platform?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	msg := fmt.Sprintf("created team %s (%s)", team.Name, team.ID)
	a.endTrace(msg, nil)
	http.Redirect(w, r, "/platform?ok="+url.QueryEscape(msg), http.StatusSeeOther)
}

type platformDetail struct {
	Project  *cell.ProjectResponse
	HostURL  string
	Teams    []cell.TeamView
	FlashOK  string
	FlashErr string
	Error    string
}
