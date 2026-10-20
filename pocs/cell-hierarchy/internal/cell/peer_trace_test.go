package cell_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/zitadel/nextgen/pocs/cell-hierarchy/internal/cell"
)

func TestPeerClientOnHopFiresForGetMe(t *testing.T) {
	store, err := cell.OpenStore(t.TempDir()+"/c.db", "http://eu-1", "eu-1", false)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	srv := cell.NewServer(store, nil, nil)
	httpSrv := httptest.NewServer(srv.Handler())
	defer httpSrv.Close()

	peer := cell.NewPeerClient()
	var mu sync.Mutex
	var hops []cell.TraceHop
	peer.OnHop = func(h cell.TraceHop) {
		mu.Lock()
		hops = append(hops, h)
		mu.Unlock()
	}
	peer.SetDelayConfig(nil, map[string]string{httpSrv.URL: "eu-1"})

	_, err = peer.GetMe(context.Background(), httpSrv.URL)
	if err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(hops) != 1 {
		t.Fatalf("hops=%d want 1: %+v", len(hops), hops)
	}
	if hops[0].Method != "GET /v1/me" {
		t.Fatalf("method=%q", hops[0].Method)
	}
	if hops[0].Result != "200" {
		t.Fatalf("result=%q", hops[0].Result)
	}
}

func TestPairwiseDelaySleepsBetweenCells(t *testing.T) {
	storeB, err := cell.OpenStore(t.TempDir()+"/b.db", "http://us-1", "us-1", false)
	if err != nil {
		t.Fatal(err)
	}
	defer storeB.Close()

	srvB := cell.NewServer(storeB, nil, nil)
	httpB := httptest.NewServer(srvB.Handler())
	defer httpB.Close()

	peer := cell.NewPeerClient()
	peer.SelfURL = "http://eu-1"
	peer.SetDelayConfig(
		map[string]int{cell.PairKey("eu-1", "us-1"): 30},
		map[string]string{
			cell.NormalizeURL("http://eu-1"): "eu-1",
			cell.NormalizeURL(httpB.URL):     "us-1",
		},
	)

	start := time.Now()
	_, err = peer.GetMe(context.Background(), httpB.URL)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	if elapsed < 25*time.Millisecond {
		t.Fatalf("elapsed=%v want >=25ms pairwise delay", elapsed)
	}
	if elapsed > 500*time.Millisecond {
		t.Fatalf("elapsed=%v unexpectedly long", elapsed)
	}
}

func TestAdminDelaysEndpoint(t *testing.T) {
	store, err := cell.OpenStore(t.TempDir()+"/c.db", "http://eu-1", "eu-1", false)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	peer := cell.NewPeerClient()
	srv := cell.NewServer(store, peer, nil)
	httpSrv := httptest.NewServer(srv.Handler())
	defer httpSrv.Close()

	client := cell.NewPeerClient()
	err = client.DoRaw(context.Background(), http.MethodPost, httpSrv.URL+"/v1/admin/delays", map[string]any{
		"pairs":  map[string]int{cell.PairKey("eu-1", "us-1"): 40},
		"labels": map[string]string{"http://eu-1": "eu-1", "http://us-1": "us-1"},
	}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	d := peer.DelayBetween("http://eu-1", "http://us-1")
	if d != 40*time.Millisecond {
		t.Fatalf("delay=%v want 40ms", d)
	}
}
