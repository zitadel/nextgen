package harness

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	api "github.com/zitadel/nextgen/api/generated"
)

func newClient(t *testing.T, srv *httptest.Server) *api.Client {
	t.Helper()
	//egress:allow test client against an httptest server
	c, err := api.NewClient(srv.URL, NewCredentials("secret"), api.WithClient(http.DefaultClient))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func opError(t *testing.T, err error) *OpError {
	t.Helper()
	oe, ok := errors.AsType[*OpError](err)
	if !ok {
		t.Fatalf("error %v (%T) is not an *OpError", err, err)
	}
	return oe
}

// TestLoginClassifiesErrorDetails: a 400 error-details body on POST /flow
// becomes an OpError carrying the body's code and the status class.
func TestLoginClassifiesErrorDetails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"flow.invalid_purpose","message":"unknown purpose"}`))
	}))
	defer srv.Close()

	_, err := Login(t.Context(), newClient(t, srv), Target{ProjectID: "p"})
	oe := opError(t, err)
	if oe.Op != OpCreateFlow || oe.Status != 400 || oe.Code != "flow.invalid_purpose" || oe.StatusClass() != "4xx" {
		t.Errorf("classified as %+v", oe)
	}
}

// TestLoginClassifiesStepError: a rejected input is a 200 that re-serves
// the step with an error key, and must count as a failure of the submit.
func TestLoginClassifiesStepError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		http.SetCookie(w, &http.Cookie{Name: "_zflow", Value: "sealed", Path: "/"})
		if r.URL.Path == "/flow" {
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"flow_1","session_id":"sess_1","step":{"name":"identifier","type":"form","fields":[],"actions":[],"gates":{}}}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"flow_1","session_id":"sess_1","step":{"name":"identifier","type":"form","error":"error.email_invalid","fields":[],"actions":[],"gates":{}}}`))
	}))
	defer srv.Close()

	_, err := Login(t.Context(), newClient(t, srv), Target{ProjectID: "p", Email: "nobody"})
	oe := opError(t, err)
	if oe.Op != OpSubmitIdent || oe.Status != 200 || oe.Code != CodeStepError || oe.StatusClass() != "2xx" {
		t.Errorf("classified as %+v", oe)
	}
}

// TestGetUserClassifiesUnauthorized: the aliased error-details types still
// yield the body's code.
func TestGetUserClassifiesUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"auth.unauthorized","message":"Missing or invalid session token."}`))
	}))
	defer srv.Close()

	_, err := GetUser(t.Context(), newClient(t, srv), Target{UserID: "user_1"})
	oe := opError(t, err)
	if oe.Op != OpGetUser || oe.Status != 401 || oe.Code != "auth.unauthorized" {
		t.Errorf("classified as %+v", oe)
	}
}

// TestClassifyTransport: no response at all is status 0, class "0".
func TestClassifyTransport(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	srv.Close()
	_, err := GetUser(t.Context(), newClient(t, srv), Target{UserID: "user_1"})
	oe := opError(t, err)
	if oe.Status != 0 || oe.Code != CodeTransport || oe.StatusClass() != "0" {
		t.Errorf("classified as %+v", oe)
	}
}
