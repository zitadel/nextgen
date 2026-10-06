package harness

import (
	"fmt"
	"regexp"
)

// The naming convention every resource this harness creates carries. `clean`
// deletes a resource only when it is in the manifest AND its name matches one
// of these patterns in full: the patterns are anchored at both ends, never a
// prefix or substring test, because the target hosts resources this harness
// did not create and a lookalike must not be taken for one of ours.
var (
	// projectName: `bench-` and then lowercase words joined by hyphens.
	projectName = regexp.MustCompile(`^bench-[a-z0-9]+(?:-[a-z0-9]+)*$`)
	// userEmail: a local part of lowercase words in the reserved `bench.local`
	// domain, which resolves nowhere and so belongs to no real person.
	userEmail = regexp.MustCompile(`^[a-z0-9]+(?:[._-][a-z0-9]+)*@bench\.local$`)
)

// populationEmailFormat is the address of the n-th member of a user
// population; it matches userEmail by construction.
const populationEmailFormat = "bench-user-%05d@bench.local"

// PopulationEmail returns the address of the n-th (1-based) population user.
func PopulationEmail(n int) string { return fmt.Sprintf(populationEmailFormat, n) }

// OwnsProjectName reports whether name follows the convention in full.
func OwnsProjectName(name string) bool { return projectName.MatchString(name) }

// OwnsEmail reports whether email follows the convention in full.
func OwnsEmail(email string) bool { return userEmail.MatchString(email) }
