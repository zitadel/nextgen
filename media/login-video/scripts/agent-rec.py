"""Run a coding agent headless on one prompt and record its events with timestamps.

usage: python3 agent-rec.py <app dir> <out.jsonl> <prompt> [--continue | --resume <session>] [--tools a,b,...]
Runs Claude Code (CLAUDE_BIN, else `claude` on PATH) with stream-json output in a
plain terminal environment: the agent sees no desktop-app variables, the CLI's
telemetry goes to its development channel, and npm uses npm_config_cache when set.
Each output line is {"t": seconds since start, "e": <event>}.
"""
import json, os, shutil, subprocess, sys, time

app, out, prompt = sys.argv[1:4]
rest = sys.argv[4:]
cont = "--continue" in rest
tools = rest[rest.index("--tools") + 1].split(",") if "--tools" in rest else []
claude = os.environ.get("CLAUDE_BIN") or shutil.which("claude")
if not claude:
    sys.exit("set CLAUDE_BIN or put claude on PATH")

keep = ["HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "TMPDIR", "TERM", "npm_config_cache"]
env = {k: os.environ[k] for k in keep if k in os.environ}
env["ZITADEL_TELEMETRY_ENV"] = "development"

cmd = [claude, "-p", prompt, "--output-format", "stream-json", "--verbose"]
if cont:
    cmd.append("--continue")
if "--resume" in rest:
    cmd += ["--resume", rest[rest.index("--resume") + 1]]
if tools:
    cmd += ["--allowedTools", *tools]

t0 = time.time()
with open(out, "w") as f, open(out + ".stderr", "w") as err:
    p = subprocess.Popen(cmd, cwd=app, env=env, stdout=subprocess.PIPE, stderr=err, text=True, bufsize=1)
    for line in p.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            e = {"type": "raw", "text": line}
        f.write(json.dumps({"t": round(time.time() - t0, 3), "e": e}) + "\n")
        f.flush()
        if e.get("type") == "assistant":
            for c in e["message"].get("content", []):
                if c.get("type") == "tool_use":
                    print(f"{time.time() - t0:7.1f}s  {c['name']}: {json.dumps(c['input'])[:140]}", flush=True)
                elif c.get("type") == "text" and c.get("text", "").strip():
                    print(f"{time.time() - t0:7.1f}s  says: {c['text'].strip()[:140]}", flush=True)
        elif e.get("type") == "result":
            print(f"{time.time() - t0:7.1f}s  done: {e.get('subtype')} error={e.get('is_error')} turns={e.get('num_turns')}", flush=True)
    p.wait()
sys.exit(p.returncode)
