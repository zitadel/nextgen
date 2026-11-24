"""Run a command in a pseudo-terminal and record its output with timestamps.

usage: ptyrec.py <out.jsonl> <cwd> <max_seconds> <idle_enter_seconds> -- cmd args...

Each line of out.jsonl is {"t": seconds since start, "o": text} for output, or
{"t": ..., "i": text} for input we sent. When the command prints nothing for
idle_enter_seconds while still running, we press Enter (accept the default) and
log it, so interactive prompts are answered the way a hurried human would.
A max_seconds of 0 means wait for exit.
"""
import fcntl, json, os, pty, select, signal, struct, subprocess, sys, termios, time

out_path, cwd, max_s, idle_s = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
cmd = sys.argv[sys.argv.index("--") + 1:]

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 104, 0, 0))
env = dict(os.environ, TERM="xterm-256color", COLUMNS="104", LINES="32")
proc = subprocess.Popen(cmd, cwd=cwd, stdin=slave, stdout=slave, stderr=slave, env=env,
                        start_new_session=True)
os.close(slave)
t0 = time.time()
last = t0
last_text = ""
import re
PROMPT = re.compile(r"Enter: confirm|Enter: submit|Enter to continue|\(y/n\)|Yes / .*No\s*\n", re.I)
ANSWERS = json.loads(os.environ.get("ANSWERS", "[]"))
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
with open(out_path, "w") as f:
    f.write(json.dumps({"t": 0, "epoch": t0}) + "\n")
    while True:
        now = time.time()
        if max_s and now - t0 > max_s:
            try:
                os.killpg(proc.pid, signal.SIGINT)
            except (ProcessLookupError, PermissionError):
                pass
            time.sleep(1.5)
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            break
        r, _, _ = select.select([master], [], [], 0.05)
        if r:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            last = time.time()
            last_text = (last_text + ANSI.sub("", data.decode("utf-8", "replace")))[-300:]
            f.write(json.dumps({"t": round(last - t0, 3), "o": data.decode("utf-8", "replace")}) + "\n")
            f.flush()
        elif proc.poll() is not None:
            break
        elif idle_s and time.time() - last > idle_s and PROMPT.search(last_text):
            ans = ANSWERS.pop(0) if ANSWERS else "\r"
            os.write(master, ans.encode())
            last = time.time()
            last_text = ""
            f.write(json.dumps({"t": round(last - t0, 3), "i": ans}) + "\n")
            f.flush()
    rc = proc.wait()
    f.write(json.dumps({"t": round(time.time() - t0, 3), "exit": rc}) + "\n")
print("exit", rc, "after", round(time.time() - t0, 1), "s")
