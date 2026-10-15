package domain

// DeploymentTargetPrimary is the targets keyword for every primary origin of
// the project.
const DeploymentTargetPrimary = "primary"

// ResolvePrimaryTargets expands targets to primary origins: the primary
// keyword to every primary origin, an exact origin when it is one. A
// deployment to preview URLs is not served yet.
func ResolvePrimaryTargets(origins []Origin, targets []string) ([]string, error) {
	var primary []string
	for _, o := range origins {
		if o.Kind == OriginKindPrimary {
			primary = append(primary, o.Pattern)
		}
	}

	var resolved []string
	for _, target := range targets {
		if target == DeploymentTargetPrimary {
			if len(primary) == 0 {
				return nil, ErrDeploymentInvalid("the project has no primary origin", nil)
			}
			resolved = append(resolved, primary...)
			continue
		}
		if !isPrimaryOrigin(origins, target) {
			return nil, ErrNotImplemented()
		}
		resolved = append(resolved, target)
	}
	return resolved, nil
}

func isPrimaryOrigin(origins []Origin, origin string) bool {
	for _, o := range origins {
		if o.Kind == OriginKindPrimary && o.Pattern == origin {
			return true
		}
	}
	return false
}
