package ui

import (
	"embed"
	"io"
	"io/fs"
	"net/http"
)

//go:embed web/*
var webFS embed.FS

func (a *App) registerSPA(mux *http.ServeMux) {
	assets, err := fs.Sub(webFS, "web")
	if err != nil {
		panic("ui: embed web: " + err.Error())
	}
	fileServer := http.FileServer(http.FS(assets))
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", fileServer))

	spa := a.serveSPA
	mux.HandleFunc("GET /{$}", spa)
	mux.HandleFunc("GET /cells/{label}", spa)
	mux.HandleFunc("GET /platform", spa)
	mux.HandleFunc("GET /workspaces", spa)
	mux.HandleFunc("GET /projects/{id}", spa)
	mux.HandleFunc("GET /trace-view", spa)
	mux.HandleFunc("GET /trace-page", spa)
}

func (a *App) serveSPA(w http.ResponseWriter, r *http.Request) {
	f, err := webFS.Open("web/index.html")
	if err != nil {
		http.Error(w, "spa index missing", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = io.Copy(w, f)
}
