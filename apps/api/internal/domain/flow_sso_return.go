package domain

// FlowSSOReturn is the browser-side context of an external sign-in,
// derived from the HTTP request at the API edge: RedirectURI is the
// callback route the provider sends the browser to, ReturnTarget the page
// the callback hands the browser back to.
type FlowSSOReturn struct {
	RedirectURI  string
	ReturnTarget string
}
