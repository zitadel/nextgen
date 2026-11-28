package view_test

import (
	"strings"
	"testing"

	"github.com/a-h/templ"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"go.zitadel.com/zitadel/v5/login/view"
)

func TestPage(t *testing.T) {
	var out strings.Builder
	ctx := templ.WithChildren(t.Context(), templ.Raw(`<p id="step">hello</p>`))
	require.NoError(t, view.Page("de", "Anmelden", "main{color:red}").Render(ctx, &out))

	html := out.String()
	assert.True(t, strings.HasPrefix(html, "<!doctype html>"), html)
	assert.Contains(t, html, `<html lang="de">`)
	assert.Contains(t, html, "<title>Anmelden</title>")
	assert.Contains(t, html, "<style>main{color:red}</style>")
	assert.Contains(t, html, `<main><p id="step">hello</p></main>`)
}
