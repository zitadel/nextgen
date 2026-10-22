package httputil_test

/*
func TestGetJSON(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name       string
		setup      func(t *testing.T) (url string, client *http.Client, cleanup func())
		dstFactory func() any
		wantErr    func(t *testing.T, err error)
		verifyDst  func(t *testing.T, dst any)
	}{
		{
			name: "network error",
			setup: func(t *testing.T) (string, *http.Client, func()) {
				t.Helper()
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusOK)
				}))
				url := srv.URL
				srv.Close()
				return url, http.DefaultClient, func() {}
			},
			dstFactory: func() any { return &struct{}{} },
			wantErr: func(t *testing.T, err error) {
				t.Helper()
				// Dial to a closed httptest.Server yields a connection error from client.Do.
				require.Error(t, err)
				assert.Contains(t, strings.ToLower(err.Error()), "refused")
			},
		},
		{
			name: "non-200 status returns StatusError",
			setup: func(t *testing.T) (string, *http.Client, func()) {
				t.Helper()
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusNotFound)
					_, _ = w.Write([]byte("not found"))
				}))
				return srv.URL, http.DefaultClient, srv.Close
			},
			dstFactory: func() any { return &struct{}{} },
			wantErr: func(t *testing.T, err error) {
				t.Helper()
				var se *httputil.StatusError
				require.ErrorAs(t, err, &se)
				assert.Equal(t, http.StatusNotFound, se.StatusCode)
				assert.Equal(t, []byte("not found"), se.Body)
			},
		},
		{
			name: "wrong content-type returns ContentTypeError",
			setup: func(t *testing.T) (string, *http.Client, func()) {
				t.Helper()
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "text/plain")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write([]byte(`{}`))
				}))
				return srv.URL, http.DefaultClient, srv.Close
			},
			dstFactory: func() any { return &map[string]any{} },
			wantErr: func(t *testing.T, err error) {
				t.Helper()
				var ce *httputil.ContentTypeError
				require.ErrorAs(t, err, &ce)
				assert.Equal(t, `unexpected content type: text/plain, expected application/json`, ce.Error())
			},
		},
		{
			name: "malformed JSON returns decode error",
			setup: func(t *testing.T) (string, *http.Client, func()) {
				t.Helper()
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write([]byte(`{`))
				}))
				return srv.URL, http.DefaultClient, srv.Close
			},
			dstFactory: func() any { return &map[string]any{} },
			wantErr: func(t *testing.T, err error) {
				t.Helper()
				require.Error(t, err)
				var syn *json.SyntaxError
				okDecodeErr := errors.As(err, &syn) || errors.Is(err, io.ErrUnexpectedEOF)
				assert.True(t, okDecodeErr, "want json.SyntaxError or io.ErrUnexpectedEOF, got %#v", err)
			},
		},
		{
			name: "happy path",
			setup: func(t *testing.T) (string, *http.Client, func()) {
				t.Helper()
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write([]byte(`{"answer":42}`))
				}))
				return srv.URL, http.DefaultClient, srv.Close
			},
			dstFactory: func() any {
				m := map[string]any{}
				return &m
			},
			wantErr: func(t *testing.T, err error) {
				t.Helper()
				require.NoError(t, err)
			},
			verifyDst: func(t *testing.T, dst any) {
				t.Helper()
				require.IsType(t, &map[string]any{}, dst, "dst type")
				m := dst.(*map[string]any)
				assert.Equal(t, map[string]any{"answer": float64(42)}, *m)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			url, client, cleanup := tt.setup(t)
			defer cleanup()

			dst := tt.dstFactory()
			err := httputil.GetJSON(ctx, url, client, dst)
			tt.wantErr(t, err)
			if tt.verifyDst != nil {
				tt.verifyDst(t, dst)
			}
		})
	}
}
*/
