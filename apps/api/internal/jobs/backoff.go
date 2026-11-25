package jobs

import "time"

// backoffFor returns exponential backoff for the attempt count observed at
// Take (before Fail increments). Cap is cfg.BackoffCap.
func backoffFor(attempt int, cap time.Duration) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	// 1s, 2s, 4s, … — shift saturates past 62 but we always min with cap.
	d := time.Second
	if attempt < 62 {
		d = time.Second << attempt
	} else {
		d = cap
	}
	if d > cap || d <= 0 {
		return cap
	}
	return d
}
