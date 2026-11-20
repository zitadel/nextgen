package slice_util

func FindFunc[E any](s []E, f func(E) bool) (element E, found bool) {
	for _, e := range s {
		if f(e) {
			return e, true
		}
	}
	return *new(E), false
}
