package cell

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type FGACheckRequest struct {
	ProjectID     string   `json:"project_id"`
	Object        string   `json:"object"`
	Relation      string   `json:"relation"`
	UserKey       string   `json:"user_key"`
	HomeProjectID string   `json:"home_project_id,omitempty"`
	HomeCellURL   string   `json:"home_cell_url,omitempty"`
	DelayMs       *int     `json:"delay_ms,omitempty"`
	MaxDepth      *int     `json:"max_depth,omitempty"`
	Visited       []string `json:"visited,omitempty"`
}

type FGACheckResponse struct {
	Allowed       bool       `json:"allowed"`
	Reason        string     `json:"reason"`
	Trace         []TraceHop `json:"trace"`
	TotalMs       int64      `json:"total_ms"`
	CrossCellHops int        `json:"cross_cell_hops"`
	Depth         int        `json:"depth"`
}

type FGAExpandRequest struct {
	ProjectID string   `json:"project_id"`
	Object    string   `json:"object"`
	Relation  string   `json:"relation"`
	DelayMs   *int     `json:"delay_ms,omitempty"`
	MaxDepth  *int     `json:"max_depth,omitempty"`
	Visited   []string `json:"visited,omitempty"`
	Depth     int      `json:"depth,omitempty"`
}

type FGAMember struct {
	Kind          string `json:"kind"`
	Key           string `json:"key"`
	HomeProjectID string `json:"home_project_id,omitempty"`
	HomeCellURL   string `json:"home_cell_url,omitempty"`
}

type FGAExpandResponse struct {
	Members       []FGAMember `json:"members"`
	Trace         []TraceHop  `json:"trace"`
	TotalMs       int64       `json:"total_ms"`
	CrossCellHops int         `json:"cross_cell_hops"`
	CycleStopped  bool        `json:"cycle_stopped,omitempty"`
	DepthCapHit   bool        `json:"depth_cap_hit,omitempty"`
}

func (s *Server) registerFGARoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/fga/check", s.handleFGACheck)
	mux.HandleFunc("POST /v1/fga/expand", s.handleFGAExpand)
}

func (s *Server) handleFGACheck(w http.ResponseWriter, r *http.Request) {
	var req FGACheckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	projectID := strings.TrimSpace(req.ProjectID)
	object := strings.TrimSpace(req.Object)
	relation := strings.TrimSpace(req.Relation)
	userKey := NormalizeKey(req.UserKey)
	if projectID == "" || object == "" || relation == "" || userKey == "" {
		writeErr(w, http.StatusBadRequest, "project_object_relation_user_key_required")
		return
	}
	if _, err := s.Store.GetProject(projectID); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	delay := s.fgaDelay(req.DelayMs)
	maxDepth := fgaMaxDepth(req.MaxDepth)
	visited := visitedSet(req.Visited)

	start := time.Now()
	allowed, reason, trace, depth, err := s.fgaCheck(r.Context(), fgaCheckArgs{
		projectID:     projectID,
		object:        object,
		relation:      relation,
		userKey:       userKey,
		homeProjectID: strings.TrimSpace(req.HomeProjectID),
		homeCellURL:   NormalizeURL(req.HomeCellURL),
		delay:         delay,
		maxDepth:      maxDepth,
		depth:         0,
		visited:       visited,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, FGACheckResponse{
		Allowed:       allowed,
		Reason:        reason,
		Trace:         trace,
		TotalMs:       time.Since(start).Milliseconds(),
		CrossCellHops: countCrossCellHops(trace),
		Depth:         depth,
	})
}

func (s *Server) handleFGAExpand(w http.ResponseWriter, r *http.Request) {
	var req FGAExpandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_json")
		return
	}
	projectID := strings.TrimSpace(req.ProjectID)
	object := strings.TrimSpace(req.Object)
	relation := strings.TrimSpace(req.Relation)
	if projectID == "" || object == "" || relation == "" {
		writeErr(w, http.StatusBadRequest, "project_object_relation_required")
		return
	}
	if _, err := s.Store.GetProject(projectID); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	delay := s.fgaDelay(req.DelayMs)
	maxDepth := fgaMaxDepth(req.MaxDepth)
	visited := visitedSet(req.Visited)

	start := time.Now()
	out, err := s.fgaExpand(r.Context(), fgaExpandArgs{
		projectID: projectID,
		object:    object,
		relation:  relation,
		delay:     delay,
		maxDepth:  maxDepth,
		depth:     req.Depth,
		visited:   visited,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out.TotalMs = time.Since(start).Milliseconds()
	out.CrossCellHops = countCrossCellHops(out.Trace)
	writeJSON(w, http.StatusOK, out)
}

type fgaCheckArgs struct {
	projectID     string
	object        string
	relation      string
	userKey       string
	homeProjectID string
	homeCellURL   string
	delay         time.Duration
	maxDepth      int
	depth         int
	visited       map[string]bool
}

type fgaExpandArgs struct {
	projectID string
	object    string
	relation  string
	delay     time.Duration
	maxDepth  int
	depth     int
	visited   map[string]bool
}

func (s *Server) fgaCheck(ctx context.Context, args fgaCheckArgs) (allowed bool, reason string, trace []TraceHop, depth int, err error) {
	meta, err := s.Store.GetMeta()
	if err != nil {
		return false, "", nil, args.depth, err
	}
	nodeKey := expandVisitKey(meta.URL, args.projectID, args.object, args.relation)
	if args.visited[nodeKey] {
		trace = append(trace, TraceHop{
			Cell: meta.URL, Method: "fga check cycle",
			Ms: 0, Result: "cycle_stopped@" + nodeKey,
		})
		return false, ErrExpandCycle.Error(), trace, args.depth, nil
	}
	if args.depth >= args.maxDepth {
		trace = append(trace, TraceHop{
			Cell: meta.URL, Method: "fga check depth",
			Ms: 0, Result: fmt.Sprintf("max_depth_%d", args.maxDepth),
		})
		return false, ErrMaxDepthExceeded.Error(), trace, args.depth, nil
	}
	args.visited[nodeKey] = true

	if err := sleepDelay(ctx, args.delay); err != nil {
		return false, "", nil, args.depth, err
	}
	hopStart := time.Now()
	tuples, err := s.Store.ListTuplesForRelation(args.projectID, args.object, args.relation)
	if err != nil {
		return false, "", nil, args.depth, err
	}
	trace = append(trace, TraceHop{
		Cell: meta.URL, Method: "local fga check",
		Ms:     time.Since(hopStart).Milliseconds(),
		Result: fmt.Sprintf("%s#%s tuples=%d depth=%d", args.object, args.relation, len(tuples), args.depth),
	})

	for _, t := range tuples {
		switch t.Kind() {
		case SubjectKindUser:
			if t.UserKey != args.userKey {
				continue
			}
			if args.homeProjectID != "" && t.HomeProjectID != "" && t.HomeProjectID != args.homeProjectID {
				continue
			}
			if args.homeCellURL != "" && t.HomeCellURL != "" && NormalizeURL(t.HomeCellURL) != args.homeCellURL {
				continue
			}
			trace = append(trace, TraceHop{
				Cell: meta.URL, Method: "direct user grant",
				Ms: 0, Result: "allowed@" + t.Subject(),
			})
			return true, "ok", trace, args.depth, nil

		case SubjectKindGroup:
			groupObj := "group:" + t.UserKey
			homeProj := t.HomeProjectID
			homeCell := NormalizeURL(t.HomeCellURL)
			if homeProj == "" {
				homeProj = args.projectID
			}
			if homeCell == "" {
				homeCell = meta.URL
			}

			if NormalizeURL(homeCell) == NormalizeURL(meta.URL) {
				ok, nestedReason, nestedTrace, nestedDepth, nestedErr := s.fgaCheck(ctx, fgaCheckArgs{
					projectID:     homeProj,
					object:        groupObj,
					relation:      "member",
					userKey:       args.userKey,
					homeProjectID: args.homeProjectID,
					homeCellURL:   args.homeCellURL,
					delay:         args.delay,
					maxDepth:      args.maxDepth,
					depth:         args.depth + 1,
					visited:       args.visited,
				})
				trace = append(trace, nestedTrace...)
				if nestedErr != nil {
					return false, "", trace, nestedDepth, nestedErr
				}
				if ok {
					return true, "ok", trace, nestedDepth, nil
				}
				if nestedReason == ErrExpandCycle.Error() || nestedReason == ErrMaxDepthExceeded.Error() {
					reason = nestedReason
				}
				continue
			}

			// Cross-cell: expand remote group and look for the user among members.
			rpcStart := time.Now()
			delayMs := int(args.delay / time.Millisecond)
			maxDepth := args.maxDepth
			remote, rpcErr := s.Peer.FGAExpand(ctx, homeCell, FGAExpandRequest{
				ProjectID: homeProj,
				Object:    groupObj,
				Relation:  "member",
				DelayMs:   &delayMs,
				MaxDepth:  &maxDepth,
				Visited:   visitedList(args.visited),
				Depth:     args.depth + 1,
			})
			hop := TraceHop{
				Cell:   homeCell,
				Method: "POST /v1/fga/expand",
				Ms:     time.Since(rpcStart).Milliseconds(),
			}
			if rpcErr != nil {
				hop.Result = "error: " + rpcErr.Error()
				trace = append(trace, hop)
				continue
			}
			hop.Result = fmt.Sprintf("members=%d cross_cell=1", len(remote.Members))
			trace = append(trace, hop)
			trace = append(trace, remote.Trace...)
			for _, m := range remote.Members {
				if m.Kind == SubjectKindUser && NormalizeKey(m.Key) == args.userKey {
					trace = append(trace, TraceHop{
						Cell: meta.URL, Method: "group member match",
						Ms: 0, Result: fmt.Sprintf("allowed via %s@%s", groupObj, homeProj),
					})
					return true, "ok", trace, args.depth + 1, nil
				}
			}
			if remote.CycleStopped {
				reason = ErrExpandCycle.Error()
			}
			if remote.DepthCapHit {
				reason = ErrMaxDepthExceeded.Error()
			}
		}
	}

	if reason == "" {
		reason = ErrGrantDenied.Error()
	}
	return false, reason, trace, args.depth, nil
}

func (s *Server) fgaExpand(ctx context.Context, args fgaExpandArgs) (FGAExpandResponse, error) {
	meta, err := s.Store.GetMeta()
	if err != nil {
		return FGAExpandResponse{}, err
	}
	var out FGAExpandResponse
	nodeKey := expandVisitKey(meta.URL, args.projectID, args.object, args.relation)
	if args.visited[nodeKey] {
		out.CycleStopped = true
		out.Trace = append(out.Trace, TraceHop{
			Cell: meta.URL, Method: "fga expand cycle",
			Ms: 0, Result: "cycle_stopped@" + nodeKey,
		})
		return out, nil
	}
	if args.depth >= args.maxDepth {
		out.DepthCapHit = true
		out.Trace = append(out.Trace, TraceHop{
			Cell: meta.URL, Method: "fga expand depth",
			Ms: 0, Result: fmt.Sprintf("max_depth_%d", args.maxDepth),
		})
		return out, nil
	}
	args.visited[nodeKey] = true

	if err := sleepDelay(ctx, args.delay); err != nil {
		return FGAExpandResponse{}, err
	}
	hopStart := time.Now()
	tuples, err := s.Store.ListTuplesForRelation(args.projectID, args.object, args.relation)
	if err != nil {
		return FGAExpandResponse{}, err
	}
	out.Trace = append(out.Trace, TraceHop{
		Cell: meta.URL, Method: "local fga expand",
		Ms:     time.Since(hopStart).Milliseconds(),
		Result: fmt.Sprintf("%s#%s tuples=%d depth=%d", args.object, args.relation, len(tuples), args.depth),
	})

	seenUser := map[string]bool{}
	for _, t := range tuples {
		switch t.Kind() {
		case SubjectKindUser:
			ukey := NormalizeKey(t.UserKey)
			id := ukey + "|" + t.HomeProjectID + "|" + NormalizeURL(t.HomeCellURL)
			if seenUser[id] {
				continue
			}
			seenUser[id] = true
			out.Members = append(out.Members, FGAMember{
				Kind: SubjectKindUser, Key: ukey,
				HomeProjectID: t.HomeProjectID, HomeCellURL: t.HomeCellURL,
			})

		case SubjectKindGroup:
			groupObj := "group:" + t.UserKey
			homeProj := t.HomeProjectID
			homeCell := NormalizeURL(t.HomeCellURL)
			if homeProj == "" {
				homeProj = args.projectID
			}
			if homeCell == "" {
				homeCell = meta.URL
			}

			if NormalizeURL(homeCell) == NormalizeURL(meta.URL) {
				nested, nestedErr := s.fgaExpand(ctx, fgaExpandArgs{
					projectID: homeProj,
					object:    groupObj,
					relation:  "member",
					delay:     args.delay,
					maxDepth:  args.maxDepth,
					depth:     args.depth + 1,
					visited:   args.visited,
				})
				if nestedErr != nil {
					return FGAExpandResponse{}, nestedErr
				}
				out.Trace = append(out.Trace, nested.Trace...)
				if nested.CycleStopped {
					out.CycleStopped = true
				}
				if nested.DepthCapHit {
					out.DepthCapHit = true
				}
				for _, m := range nested.Members {
					id := m.Kind + "|" + m.Key + "|" + m.HomeProjectID + "|" + NormalizeURL(m.HomeCellURL)
					if m.Kind == SubjectKindUser {
						uid := NormalizeKey(m.Key) + "|" + m.HomeProjectID + "|" + NormalizeURL(m.HomeCellURL)
						if seenUser[uid] {
							continue
						}
						seenUser[uid] = true
					} else if seenUser[id] {
						continue
					} else {
						seenUser[id] = true
					}
					out.Members = append(out.Members, m)
				}
				continue
			}

			rpcStart := time.Now()
			delayMs := int(args.delay / time.Millisecond)
			maxDepth := args.maxDepth
			remote, rpcErr := s.Peer.FGAExpand(ctx, homeCell, FGAExpandRequest{
				ProjectID: homeProj,
				Object:    groupObj,
				Relation:  "member",
				DelayMs:   &delayMs,
				MaxDepth:  &maxDepth,
				Visited:   visitedList(args.visited),
				Depth:     args.depth + 1,
			})
			hop := TraceHop{
				Cell: homeCell, Method: "POST /v1/fga/expand",
				Ms: time.Since(rpcStart).Milliseconds(),
			}
			if rpcErr != nil {
				hop.Result = "error: " + rpcErr.Error()
				out.Trace = append(out.Trace, hop)
				continue
			}
			hop.Result = fmt.Sprintf("members=%d cross_cell=1", len(remote.Members))
			out.Trace = append(out.Trace, hop)
			out.Trace = append(out.Trace, remote.Trace...)
			if remote.CycleStopped {
				out.CycleStopped = true
			}
			if remote.DepthCapHit {
				out.DepthCapHit = true
			}
			for _, m := range remote.Members {
				if m.Kind == SubjectKindUser {
					uid := NormalizeKey(m.Key) + "|" + m.HomeProjectID + "|" + NormalizeURL(m.HomeCellURL)
					if seenUser[uid] {
						continue
					}
					seenUser[uid] = true
				}
				out.Members = append(out.Members, m)
			}
		}
	}
	return out, nil
}

func expandVisitKey(cellURL, projectID, object, relation string) string {
	return NormalizeURL(cellURL) + "|" + projectID + "|" + object + "|" + relation
}

func visitedSet(list []string) map[string]bool {
	out := map[string]bool{}
	for _, k := range list {
		if k != "" {
			out[k] = true
		}
	}
	return out
}

func visitedList(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k, v := range set {
		if v {
			out = append(out, k)
		}
	}
	return out
}

func countCrossCellHops(trace []TraceHop) int {
	n := 0
	for _, h := range trace {
		if h.Method == "POST /v1/fga/expand" && strings.Contains(h.Result, "cross_cell=1") {
			n++
		}
	}
	return n
}

func fgaMaxDepth(override *int) int {
	if override != nil && *override > 0 {
		return *override
	}
	return DefaultFGAMaxDepth
}

func (s *Server) fgaDelay(override *int) time.Duration {
	if override != nil {
		if *override <= 0 {
			return 0
		}
		return time.Duration(*override) * time.Millisecond
	}
	if v := os.Getenv("FGA_DELAY_MS"); v != "" {
		ms, err := strconv.Atoi(v)
		if err == nil && ms > 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}
	return 0
}

func sleepDelay(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
