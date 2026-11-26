package login_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"

	"go.zitadel.com/zitadel/v5/login"
)

// The README's example: the login mounted at /login/ on an app's mux, from
// the values `zitadel setup` writes to .env.local. The deployment here is a
// test server answering the first step, so the example runs offline.
func ExampleMount() {
	deployment := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Set-Cookie", "_zflow=sealed; Path=/; HttpOnly")
		w.WriteHeader(http.StatusCreated)
		fmt.Fprint(w, `{"id":"flow_1","session_id":"sess_1","step":{"name":"identifier","texts":{"title_key":"identifier.title"},`+
			`"fields":[{"name":"email","type":"email","text_key":"identifier.field.email"}],`+
			`"actions":[{"name":"submit","kind":"submit","primary":true,"text_key":"identifier.action.submit"}],"gates":{}}}`)
	}))
	defer deployment.Close()
	os.Setenv("ZITADEL_URL", deployment.URL)
	os.Setenv("ZITADEL_PROJECT_SECRET", "zps_…")

	mux := http.NewServeMux()
	err := login.Mount(mux, "/login", login.Config{
		ServerURL:     os.Getenv("ZITADEL_URL"),
		ProjectID:     "proj_123",
		ProjectSecret: os.Getenv("ZITADEL_PROJECT_SECRET"),
		PublicOrigin:  "http://localhost:8080",
		PostSignInURL: "/",
	})
	if err != nil {
		panic(err)
	}
	// http.ListenAndServe(":8080", mux)

	app := httptest.NewServer(mux)
	defer app.Close()
	res, err := http.Get(app.URL + "/login/")
	if err != nil {
		panic(err)
	}
	fmt.Println(res.StatusCode, res.Header.Get("Content-Type"))
	// Output: 200 text/html; charset=utf-8
}
