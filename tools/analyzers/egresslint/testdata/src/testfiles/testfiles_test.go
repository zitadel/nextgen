package testfiles

import "net/http"

func inTest() {
	_ = &http.Client{} // want `constructs an http.Client outside the hardened egress package`
}
