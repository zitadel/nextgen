// Command oidc-mock is a test-only OpenID Connect provider for the journey
// e2e runner. It wraps the example server of github.com/zitadel/oidc with one
// confidential client and the fixed accounts of a users file.
package main

import (
	"errors"
	"log/slog"
	"net/http"
	"os"

	"github.com/zitadel/oidc/v3/example/server/exampleop"
	"github.com/zitadel/oidc/v3/example/server/storage"
)

type config struct {
	Issuer       string
	RedirectURI  string
	ClientID     string
	ClientSecret string
	UsersFile    string
}

func newHandler(cfg config) (http.Handler, error) {
	users, err := storage.StoreFromFile(cfg.UsersFile)
	if err != nil {
		return nil, err
	}
	clients := map[string]*storage.Client{
		cfg.ClientID: storage.WebClient(cfg.ClientID, cfg.ClientSecret, cfg.RedirectURI),
	}
	return exampleop.SetupServer(cfg.Issuer, storage.NewStorageWithClients(users, clients), slog.Default(), false), nil
}

func run() error {
	port := os.Getenv("PORT")
	cfg := config{
		Issuer:       os.Getenv("ISSUER"),
		RedirectURI:  os.Getenv("REDIRECT_URI"),
		ClientID:     os.Getenv("CLIENT_ID"),
		ClientSecret: os.Getenv("CLIENT_SECRET"),
		UsersFile:    os.Getenv("USERS_FILE"),
	}
	if port == "" || cfg.Issuer == "" || cfg.RedirectURI == "" || cfg.ClientID == "" || cfg.ClientSecret == "" || cfg.UsersFile == "" {
		return errors.New("PORT, ISSUER, REDIRECT_URI, CLIENT_ID, CLIENT_SECRET and USERS_FILE are required")
	}
	handler, err := newHandler(cfg)
	if err != nil {
		return err
	}
	slog.Info("oidc-mock listening", "issuer", cfg.Issuer, "redirect_uri", cfg.RedirectURI, "users_file", cfg.UsersFile)
	return (&http.Server{Addr: "127.0.0.1:" + port, Handler: handler}).ListenAndServe()
}

func main() {
	if err := run(); err != nil {
		slog.Error("oidc-mock stopped", "error", err)
		os.Exit(1)
	}
}
