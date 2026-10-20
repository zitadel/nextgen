// Command oidc-mock is a test-only OpenID Connect provider for the journey
// e2e runner. It wraps the example server of github.com/zitadel/oidc with one
// confidential client and the fixed accounts of a users file.
package main

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/zitadel/oidc/v3/example/server/exampleop"
	"github.com/zitadel/oidc/v3/example/server/storage"
)

type config struct {
	Issuer       string
	RedirectURIs []string
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
		cfg.ClientID: storage.WebClient(cfg.ClientID, cfg.ClientSecret, cfg.RedirectURIs...),
	}
	return exampleop.SetupServer(cfg.Issuer, storage.NewStorageWithClients(users, clients), slog.Default(), false), nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func run() error {
	port := os.Getenv("PORT")
	redirectURIs := os.Getenv("REDIRECT_URI")
	usersFile := os.Getenv("USERS_FILE")
	if port == "" || redirectURIs == "" || usersFile == "" {
		return errors.New("PORT, REDIRECT_URI and USERS_FILE are required")
	}
	cfg := config{
		// The trailing slash is part of the issuer: discovery returns it verbatim
		// and the relying party compares it exactly.
		Issuer:       fmt.Sprintf("http://localhost:%s/", port),
		RedirectURIs: strings.Split(redirectURIs, ","),
		ClientID:     envOr("CLIENT_ID", "journey"),
		ClientSecret: envOr("CLIENT_SECRET", "journey-secret"),
		UsersFile:    usersFile,
	}
	handler, err := newHandler(cfg)
	if err != nil {
		return err
	}
	slog.Info("oidc-mock listening", "issuer", cfg.Issuer, "redirect_uris", cfg.RedirectURIs, "users_file", cfg.UsersFile)
	return (&http.Server{Addr: "127.0.0.1:" + port, Handler: handler}).ListenAndServe()
}

func main() {
	if err := run(); err != nil {
		slog.Error("oidc-mock stopped", "error", err)
		os.Exit(1)
	}
}
