package ui

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

type delayPairView struct {
	Key   string `json:"key"`
	Left  string `json:"left"`
	Right string `json:"right"`
	Ms    int    `json:"ms"`
}

func (a *App) seedDefaultDelays() {
	a.delayMu.Lock()
	defer a.delayMu.Unlock()
	a.delayPairs = cell.DefaultPairDelays()
	labels := map[string]string{}
	for _, c := range a.Cells {
		labels[cell.NormalizeURL(c.URL)] = c.Label
	}
	a.Peer.SetDelayConfig(a.delayPairs, labels)
}

// broadcastDefaultDelaysSoon retries pushing the fixed matrix to every cell.
// Cells may not be up when the UI process starts; failures are logged and ignored.
func (a *App) broadcastDefaultDelaysSoon() {
	for attempt := 0; attempt < 8; attempt++ {
		time.Sleep(time.Duration(500*(attempt+1)) * time.Millisecond)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := a.broadcastDelays(ctx)
		cancel()
		if err == nil {
			if a.Log != nil {
				a.Log.Printf("broadcast default pairwise delays to %d cells", len(a.Cells))
			}
			return
		}
		if a.Log != nil {
			a.Log.Printf("broadcast delays attempt %d: %v", attempt+1, err)
		}
	}
}

func (a *App) labelMap() map[string]string {
	labels := map[string]string{}
	for _, c := range a.Cells {
		labels[cell.NormalizeURL(c.URL)] = c.Label
	}
	return labels
}

func (a *App) copyDelayPairs() map[string]int {
	a.delayMu.Lock()
	defer a.delayMu.Unlock()
	out := map[string]int{}
	for k, v := range a.delayPairs {
		out[k] = v
	}
	return out
}

func (a *App) delayPairViews() []delayPairView {
	pairs := a.copyDelayPairs()
	// Ensure default demo pairs always appear in the form even if zeroed.
	for k, v := range cell.DefaultPairDelays() {
		if _, ok := pairs[k]; !ok {
			pairs[k] = v
		}
	}
	keys := cell.SortedPairKeys(pairs)
	out := make([]delayPairView, 0, len(keys))
	for _, k := range keys {
		left, right, _ := strings.Cut(k, "|")
		out = append(out, delayPairView{Key: k, Left: left, Right: right, Ms: pairs[k]})
	}
	return out
}

func (a *App) handleCellsDelays(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/?err="+url.QueryEscape("invalid form"), http.StatusSeeOther)
		return
	}
	pairs := map[string]int{}
	for key, vals := range r.Form {
		if !strings.HasPrefix(key, "delay_") {
			continue
		}
		pair := strings.TrimPrefix(key, "delay_")
		if pair == "" || len(vals) == 0 {
			continue
		}
		ms, err := strconv.Atoi(strings.TrimSpace(vals[0]))
		if err != nil || ms < 0 {
			ms = 0
		}
		if ms > 5000 {
			ms = 5000
		}
		pairs[pair] = ms
	}
	// Keep unspecified default keys at prior/default values.
	cur := a.copyDelayPairs()
	for k, v := range cell.DefaultPairDelays() {
		if _, ok := pairs[k]; !ok {
			if old, ok2 := cur[k]; ok2 {
				pairs[k] = old
			} else {
				pairs[k] = v
			}
		}
	}
	a.applyDelayConfig(pairs)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	a.beginTrace("broadcast delays")
	err := a.broadcastDelays(ctx)
	if err != nil {
		a.endTrace(err.Error(), nil)
		http.Redirect(w, r, "/?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	a.endTrace(fmt.Sprintf("saved %d pairs", len(pairs)), nil)
	http.Redirect(w, r, "/?ok="+url.QueryEscape("delay matrix saved and broadcast"), http.StatusSeeOther)
}

func (a *App) applyDelayConfig(pairs map[string]int) {
	a.delayMu.Lock()
	a.delayPairs = map[string]int{}
	for k, v := range pairs {
		a.delayPairs[k] = v
	}
	a.delayMu.Unlock()
	a.Peer.SetDelayConfig(a.copyDelayPairs(), a.labelMap())
}

func (a *App) broadcastDelays(ctx context.Context) error {
	body := map[string]any{
		"pairs":  a.copyDelayPairs(),
		"labels": a.labelMap(),
	}
	var errs []string
	labels := make([]string, 0, len(a.Cells))
	for _, c := range a.Cells {
		labels = append(labels, c.Label)
	}
	sort.Strings(labels)
	for _, c := range a.Cells {
		err := a.Peer.DoRaw(ctx, http.MethodPost, cell.NormalizeURL(c.URL)+"/v1/admin/delays", body, "", nil)
		if err != nil {
			errs = append(errs, c.Label+": "+err.Error())
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("broadcast partial failures: %s", strings.Join(errs, "; "))
	}
	return nil
}
