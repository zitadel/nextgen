package configfs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"
	slogctx "github.com/veqryn/slog-context"
)

// The tree `zitadel setup` scaffolds, relative to the project root. The paths
// double as the prefix of a state.json key, so they are spelled with forward
// slashes and joined per-OS only when touching the filesystem.
const (
	zitadelDir      = ".zitadel"
	zitadelJSONName = "zitadel.json"
	stateFileName   = "state.json"

	schemasDir  = zitadelDir + "/schemas"
	flowsDir    = zitadelDir + "/flows"
	brandingDir = zitadelDir + "/branding"
)

// Store is one project directory, read live.
//
// Two files describe the tree rather than being resources in it, and both are
// watched so the server follows the CLI without a restart:
//
//   - `zitadel.json` names the project every document here belongs to. The
//     documents carry no project of their own.
//   - `.zitadel/state.json` is the CLI's index: it maps each resource file to
//     the id the server minted for it. Reading ids from there is what lets a
//     file-backed resource keep the identity a release, a user record or an
//     RSI row already refers to, instead of inventing one that would not match.
type Store struct {
	root    string
	watcher *fsnotify.Watcher

	// mu guards the two watched documents. They are replaced by the watcher
	// goroutine while request goroutines read them, so every access goes
	// through it.
	mu        sync.RWMutex
	projectID string
	state     StateFile
	// onChange is notified after any resource document in the tree changes.
	//
	// The store serves documents straight from disk, but the rest of the
	// server does not always read through it: a compiled schema is cached by
	// project and id, and with a file store an id keeps its value while the
	// content behind it changes. Nothing would evict that entry, so a caller
	// resolving the schema would keep getting the version from before the
	// edit. This is how the server is told to drop what it derived.
	onChange []func()
	// watchedDirs is the kind directories already added to the watcher, so a
	// directory appearing can be told from one already known.
	watchedDirs map[string]struct{}
}

// StateFile is `.zitadel/state.json` as the server reads it.
//
// The CLI writes more (hashes, the scaffold manifest, framework); this decodes
// only what the server needs, so a field the CLI adds later does not have to be
// mirrored here to keep parsing.
type StateFile struct {
	Resources map[string]StateResource `json:"resources"`
}

// StateResource is one entry of the index. The key it sits under is the
// resource file's path relative to the project root, exactly as the CLI records
// it (`.zitadel/schemas/default-human-user.json`).
type StateResource struct {
	ID string `json:"id"`
}

func NewStore(ctx context.Context, root string) (*Store, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("configfs: root directory is required")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("configfs: resolve root: %w", err)
	}

	store := &Store{root: abs, watchedDirs: map[string]struct{}{}}

	// Subscribe before the first read, never after.
	if err := store.watchFileSystem(ctx); err != nil {
		return nil, err
	}

	// Neither document has to exist yet, and neither failing to parse stops the
	// server from starting.
	//
	// The order of events in a fresh project is the reason: `zitadel setup`
	// needs a running server to upload to, and it is setup that writes
	// zitadel.json and creates .zitadel. A store that demanded a project up
	// front could never be pointed at a directory setup had not already
	// produced, which is the case this backend exists to serve. Until a project
	// is named the store holds no configuration, which before setup is the
	// truth — and the watch above is what adopts it the moment setup lands.
	if err := store.reloadZitadelJSON(); err != nil {
		slogctx.Warn(ctx, "configuration directory names no project yet",
			slogctx.Err(err), "root", abs)
	}
	if err := store.reloadStateFile(); err != nil {
		slogctx.Warn(ctx, "configuration directory has no readable index yet",
			slogctx.Err(err), "root", abs)
	}

	return store, nil
}

func (s *Store) Close() error {
	if s.watcher == nil {
		return nil
	}
	return s.watcher.Close()
}

func (s *Store) zitadelJSONPath() string {
	return filepath.Join(s.root, zitadelJSONName)
}

func (s *Store) stateFilePath() string {
	return filepath.Join(s.root, zitadelDir, stateFileName)
}

func (s *Store) watchFileSystem(ctx context.Context) error {
	if s.watcher != nil {
		if err := s.watcher.Close(); err != nil {
			return fmt.Errorf("configfs: failed to close existing filewatch: %w", err)
		}
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("configfs: failed to watch the file-system: %w", err)
	}
	s.watcher = watcher

	if err := s.watcher.Add(s.root); err != nil {
		_ = s.watcher.Close()
		return fmt.Errorf("configfs: watch %s: %w", s.root, err)
	}
	if err := s.watchZitadelDir(); err != nil {
		_ = s.watcher.Close()
		return err
	}
	s.watchResourceDirs()

	reload := map[string]func() error{
		s.zitadelJSONPath(): s.reloadZitadelJSON,
		s.stateFilePath():   s.reloadStateFile,
	}

	go s.followChanges(ctx, reload)
	return nil
}

func (s *Store) watchZitadelDir() error {
	dir := filepath.Join(s.root, zitadelDir)
	if _, err := os.Stat(dir); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("configfs: stat %s: %w", dir, err)
	}
	if err := s.watcher.Add(dir); err != nil {
		return fmt.Errorf("configfs: watch %s: %w", dir, err)
	}
	return nil
}

func (s *Store) followChanges(ctx context.Context, reload map[string]func() error) {
	defer func() {
		if err := s.watcher.Close(); err != nil {
			slogctx.Error(ctx, "error while stopping filesystem watcher", slogctx.Err(err))
		}
	}()

	for {
		select {
		case event, ok := <-s.watcher.Events:
			if !ok {
				return
			}
			if event.Op == fsnotify.Chmod {
				continue
			}

			// The tree grows while it is watched: `zitadel setup` creates
			// .zitadel and the kind directories after the server started, and
			// a developer may add one later still. Re-adding on every event
			// keeps the watch set current without tracking which directories
			// have appeared; fsnotify treats a repeat Add as a no-op.
			if s.watchResourceDirs() {
				s.notifyChanged()
			}

			if filepath.Clean(event.Name) == filepath.Join(s.root, zitadelDir) {
				if err := s.watchZitadelDir(); err != nil {
					slogctx.Error(ctx, "error while watching the .zitadel directory", slogctx.Err(err))
					continue
				}
				if err := s.reloadStateFile(); err != nil {
					slogctx.Error(ctx, "error while reloading the resource index", slogctx.Err(err))
				}
				continue
			}

			// A resource document changed: pick up directories that appeared
			// with it, then let the server drop anything it derived from the
			// previous content.
			if isResourceDocument(s.root, event.Name) {
				s.notifyChanged()
				continue
			}

			apply, watched := reload[filepath.Clean(event.Name)]
			if !watched {
				continue
			}
			if err := apply(); err != nil {
				slogctx.Error(ctx, "error while reloading a watched configuration file",
					slogctx.Err(err), "file", event.Name)
			}

		case err, ok := <-s.watcher.Errors:
			if err != nil {
				slogctx.Error(ctx, "error while watching filesystem", slogctx.Err(err))
			}
			if !ok {
				return
			}

		case <-ctx.Done():
			return

		}
	}
}

func (s *Store) reloadZitadelJSON() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bs, err := os.ReadFile(s.zitadelJSONPath())
	if err != nil {
		return fmt.Errorf("configfs: read %s: %w", zitadelJSONName, err)
	}

	contents := struct {
		Project string `json:"project"`
	}{}
	if err := json.Unmarshal(bs, &contents); err != nil {
		return fmt.Errorf("configfs: parse %s: %w", zitadelJSONName, err)
	}
	if contents.Project == "" {
		return fmt.Errorf("configfs: %s declares no project", zitadelJSONName)
	}

	s.projectID = contents.Project
	return nil
}

func (s *Store) reloadStateFile() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	bs, err := os.ReadFile(s.stateFilePath())
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			s.state = StateFile{}
			return nil
		}
		return fmt.Errorf("configfs: read %s: %w", stateFileName, err)
	}

	contents := StateFile{}
	if err := json.Unmarshal(bs, &contents); err != nil {
		return fmt.Errorf("configfs: parse %s: %w", stateFileName, err)
	}

	s.state = contents
	return nil
}

func (s *Store) Root() string { return s.root }

func (s *Store) ProjectID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.projectID
}

func (s *Store) idFor(relPath string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	resource, ok := s.state.Resources[filepath.ToSlash(relPath)]
	if !ok || resource.ID == "" {
		return "", false
	}
	return resource.ID, true
}

func (s *Store) serves(projectID string) bool {
	known := s.ProjectID()
	if known == "" {
		// No project named yet, so nothing in this tree belongs to anyone.
		// Serving reads here would attribute a half-set-up directory's files
		// to whichever project happened to ask for them.
		return false
	}
	return projectID == "" || projectID == known
}

// entry is one resource file on disk, already read.
type entry struct {
	// name is the file name without extension, the fallback handle for a kind
	// whose document carries no name of its own.
	name string
	// path is the absolute path, for diagnostics and mtime.
	path string
	// rel is the path relative to the project root, in slash form. It is the
	// key this file has in the index, and so how the entry finds its id.
	rel   string
	bytes []byte
}

// readDir returns every `.json` file in one kind's directory, ordered by name
// so a read is deterministic regardless of filesystem iteration order.
//
// A missing directory is an empty result: a project that authored no flows has
// no `flows/` directory, and that is not a failure.
func (s *Store) readDir(kind string) ([]entry, error) {
	dir := filepath.Join(s.root, kind)
	names, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("configfs: read %s: %w", dir, err)
	}

	entries := make([]entry, 0, len(names))
	for _, name := range names {
		if name.IsDir() || !strings.HasSuffix(name.Name(), ".json") {
			continue
		}
		path := filepath.Join(dir, name.Name())
		content, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("configfs: read %s: %w", path, err)
		}
		entries = append(entries, entry{
			name:  strings.TrimSuffix(name.Name(), ".json"),
			path:  path,
			rel:   kind + "/" + name.Name(),
			bytes: content,
		})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].name < entries[j].name })
	return entries, nil
}

// resourceID is the id a loaded file is served under: the one the CLI recorded
// in the index, or the resource's own handle when the index does not know it.
//
// Preferring the recorded id is what keeps a file-backed resource addressable
// by whatever already points at it — a release pointer, a user's schema
// reference, an RSI row — none of which would resolve against a handle the
// server never minted.
func (s *Store) resourceID(e entry, handle string) string {
	if id, ok := s.idFor(e.rel); ok {
		return id
	}
	return handle
}

// write puts content at kind/name.json, creating the directory if needed.
// The file is written whole via a temporary file and renamed, so a reader that
// walks the tree concurrently never observes a partial document.
func (s *Store) write(kind, name string, content []byte) error {
	dir := filepath.Join(s.root, kind)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("configfs: create %s: %w", dir, err)
	}
	final := filepath.Join(dir, name+".json")

	tmp, err := os.CreateTemp(dir, "."+name+".*.tmp")
	if err != nil {
		return fmt.Errorf("configfs: stage %s: %w", final, err)
	}
	staged := tmp.Name()
	// Best effort: after a successful rename there is nothing left to remove,
	// and on a failure path the error being returned is the useful one.
	defer func() { _ = os.Remove(staged) }()

	if _, err := tmp.Write(content); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("configfs: write %s: %w", staged, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("configfs: close %s: %w", staged, err)
	}
	if err := os.Chmod(staged, 0o600); err != nil {
		return fmt.Errorf("configfs: chmod %s: %w", staged, err)
	}
	if err := os.Rename(staged, final); err != nil {
		return fmt.Errorf("configfs: publish %s: %w", final, err)
	}
	return nil
}

// remove deletes kind/name.json. A file that is already gone is not an error,
// so a delete is idempotent the way the SQL dialects' delete-by-id is.
func (s *Store) remove(kind, name string) error {
	err := os.Remove(filepath.Join(s.root, kind, name+".json"))
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("configfs: remove %s: %w", name, err)
	}
	return nil
}

// fileName turns a resource handle into a file name safe to place in the tree.
//
// Handles reach this from documents and API calls, so a handle containing a
// separator or `..` must not be able to address a path outside the kind's
// directory. Anything outside a conservative set is percent-escaped rather
// than rejected, so a legal handle never fails to persist.
func fileName(handle string) string {
	var b strings.Builder
	for _, r := range handle {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			fmt.Fprintf(&b, "%%%02X", r)
		}
	}
	if b.Len() == 0 {
		return "_"
	}
	return b.String()
}

// withID writes id into a JSON document under key, indented.
//
// A minted id has to live in the document, because the document is the record.
// The SQL dialects keep it in a column beside the payload; a file has no such
// column, so an id that stayed in memory would be gone on the next read and the
// resource would answer to a different one than the server just returned.
//
// `$id` is where a JSON Schema already declares its identity, so writing it
// there makes the file say exactly what the server stored — the same shape a
// hand-authored schema has.
func withID(raw []byte, key, id string) ([]byte, error) {
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("configfs: parse document before stamping %s: %w", key, err)
	}
	if doc == nil {
		doc = map[string]any{}
	}
	doc[key] = id
	stamped, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("configfs: encode document after stamping %s: %w", key, err)
	}
	return stamped, nil
}

// OnConfigChange registers a callback run after any resource document in the
// tree changes. Callbacks run on the watcher goroutine, so they should be
// cheap; evicting a cache is the intended use.
func (s *Store) OnConfigChange(fn func()) {
	if fn == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onChange = append(s.onChange, fn)
}

// notifyChanged runs the registered callbacks. A copy is taken under the lock
// so a callback that registers another one cannot deadlock.
func (s *Store) notifyChanged() {
	s.mu.RLock()
	callbacks := make([]func(), len(s.onChange))
	copy(callbacks, s.onChange)
	s.mu.RUnlock()
	for _, fn := range callbacks {
		fn()
	}
}

// watchResourceDirs adds each kind's directory that exists. They are watched so
// an edit to a document — not just to the two files describing the tree — can
// invalidate what the server derived from the previous content.
//
// A missing directory is skipped rather than an error: a project with no flows
// has no flows directory, and it is added when one appears. fsnotify treats a
// repeat Add as a no-op, so this is safe to call on every event.
// It reports whether it started watching a directory it was not watching
// before. A directory only appears with documents already in it — `mkdir -p`
// then write, which is what both the CLI and an editor do — and those writes
// land before the watch does. Treating a newly watched directory as a change
// is what keeps that first document from being missed.
func (s *Store) watchResourceDirs() (added bool) {
	for _, kind := range []string{schemasDir, flowsDir, brandingDir} {
		dir := filepath.Join(s.root, kind)
		if _, err := os.Stat(dir); err != nil {
			continue
		}
		s.mu.Lock()
		_, known := s.watchedDirs[dir]
		if !known {
			s.watchedDirs[dir] = struct{}{}
		}
		s.mu.Unlock()
		if known {
			continue
		}
		if err := s.watcher.Add(dir); err == nil {
			added = true
		}
	}
	return added
}

// isResourceDocument reports whether a path names a file directly inside one of
// the kind directories.
func isResourceDocument(root, path string) bool {
	dir := filepath.Dir(filepath.Clean(path))
	for _, kind := range []string{schemasDir, flowsDir, brandingDir} {
		if dir == filepath.Join(root, kind) {
			return true
		}
	}
	return false
}
