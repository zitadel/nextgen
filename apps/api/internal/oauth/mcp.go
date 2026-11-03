package oauth

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/zitadel/nextgen/internal/build"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// mcpProtocolVersions are the MCP revisions this stub speaks, newest first.
// It needs nothing any of them changed: tools over a JSON response.
var mcpProtocolVersions = []string{"2025-11-25", "2025-06-18", "2025-03-26"}

// rpcMessage is one JSON-RPC 2.0 request or notification.
type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// whoami is the developer the token names, as the tool answers.
type whoami struct {
	UserID     string   `json:"user_id"`
	ProjectID  string   `json:"project_id"`
	Identifier string   `json:"identifier,omitempty"`
	Display    string   `json:"display,omitempty"`
	ClientID   string   `json:"client_id"`
	Scope      []string `json:"scope,omitempty"`
}

// serveMCP is a stub of an MCP server over Streamable HTTP: a protected
// resource (RFC 9728) whose one tool says who the token belongs to. It is
// stateless, answers every request with JSON rather than a stream, and opens
// no server-to-client stream (GET is 405).
func (s *Server) serveMCP(w http.ResponseWriter, r *http.Request) {
	api, _ := s.app.api(MCPAPISlug)
	token, err := s.mcpBearer(r, api)
	if err != nil {
		if !errors.Is(err, domain.ErrInvalidToken()) {
			writeServerFault(w, r, err)
			return
		}
		challenge := fmt.Sprintf(`Bearer resource_metadata=%q`, s.resourceMetadataURL(MCPAPISlug))
		if r.Header.Get("Authorization") != "" {
			challenge += `, error="invalid_token", error_description="The access token is not valid for this resource."`
		}
		w.Header().Set("WWW-Authenticate", challenge)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_token"})
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	body, err := readBody(w, r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, rpcResponse{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{Code: -32700, Message: "Parse error"}})
		return
	}
	var messages []rpcMessage
	batch := bytes.HasPrefix(bytes.TrimSpace(body), []byte("["))
	if batch {
		err = json.Unmarshal(body, &messages)
	} else {
		var one rpcMessage
		err = json.Unmarshal(body, &one)
		messages = []rpcMessage{one}
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, rpcResponse{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{Code: -32700, Message: "Parse error"}})
		return
	}
	var responses []rpcResponse
	for _, msg := range messages {
		if len(msg.ID) == 0 {
			continue // a notification gets no answer
		}
		responses = append(responses, s.answerMCP(r, token, msg))
	}
	if len(responses) == 0 {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	if batch {
		writeJSON(w, http.StatusOK, responses)
		return
	}
	writeJSON(w, http.StatusOK, responses[0])
}

func (s *Server) mcpBearer(r *http.Request, api API) (*VerifiedToken, error) {
	scheme, raw, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || raw == "" {
		return nil, domain.ErrInvalidToken()
	}
	return s.Verify(r.Context(), strings.TrimSpace(raw), api.Identifier)
}

func readBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	var buf bytes.Buffer
	_, err := buf.ReadFrom(http.MaxBytesReader(w, r.Body, maxFormSize))
	return buf.Bytes(), err
}

func (s *Server) answerMCP(r *http.Request, token *VerifiedToken, msg rpcMessage) rpcResponse {
	reply := rpcResponse{JSONRPC: "2.0", ID: msg.ID}
	switch msg.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(msg.Params, &params)
		version := mcpProtocolVersions[0]
		if slices.Contains(mcpProtocolVersions, params.ProtocolVersion) {
			version = params.ProtocolVersion
		}
		reply.Result = map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "zitadel", "title": "Zitadel", "version": build.Version()},
			"instructions":    "Zitadel's MCP server. whoami says which developer this connection acts for.",
		}
	case "ping":
		reply.Result = map[string]any{}
	case "tools/list":
		reply.Result = map[string]any{"tools": []any{map[string]any{
			"name":        "whoami",
			"title":       "Who am I",
			"description": "Returns the Zitadel developer this MCP connection acts for, and the client it signed in with.",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
			"annotations": map[string]any{"readOnlyHint": true},
		}}}
	case "tools/call":
		var params struct {
			Name string `json:"name"`
		}
		_ = json.Unmarshal(msg.Params, &params)
		if params.Name != "whoami" {
			reply.Error = &rpcError{Code: -32602, Message: "Unknown tool: " + params.Name}
			return reply
		}
		me, err := s.whoami(r, token)
		if err != nil {
			reply.Result = map[string]any{
				"isError": true,
				"content": []any{map[string]any{"type": "text", "text": "Could not read the signed-in user."}},
			}
			return reply
		}
		text, _ := json.MarshalIndent(me, "", "  ")
		reply.Result = map[string]any{
			"content":           []any{map[string]any{"type": "text", "text": string(text)}},
			"structuredContent": me,
		}
	default:
		reply.Error = &rpcError{Code: -32601, Message: "Method not found: " + msg.Method}
	}
	return reply
}

func (s *Server) whoami(r *http.Request, token *VerifiedToken) (whoami, error) {
	self, err := domain.SelfFromAccessToken(token.ProjectID, token.Subject, token.ExpiresAt, s.now())
	if err != nil {
		return whoami{}, err
	}
	user, err := s.users.GetMyUser(r.Context(), service.GetMyUserInput{Self: self})
	if err != nil {
		return whoami{}, err
	}
	me := whoami{UserID: user.ID, ProjectID: user.ProjectID, ClientID: token.ClientID, Scope: token.Scope}
	if user.Ref != nil {
		me.Identifier = user.Ref.Identifier
		me.Display = user.Ref.Display
	}
	return me, nil
}
