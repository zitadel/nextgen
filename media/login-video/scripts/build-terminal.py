"""Replay the recorded terminal sessions through a small terminal emulator.

Reads capture/rec/{start,setup,dev}.jsonl (written by ptyrec.py) and writes
data/terminal.js: the terminal's visible rows at every moment its content
changed, on the build clock (seconds since the first command was pasted).

Program output keeps its recorded timing. The shell prompt, the pasted
commands and the pauses between commands are a person's part; their timings
are the constants below.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REC = os.path.join(ROOT, "capture", "rec")
WIDTH = 104
ROWS = 24

# A person's part, in seconds on the build clock.
PASTE_TO_ENTER = 0.35  # paste a command, glance at it, press Enter
READ_PAUSE = 0.8  # read the output before pasting the next command
DEV_OUTPUT_UNTIL = 4.0  # dev server output shown (later lines are the capture's requests)

COMMANDS = [
    ("npx @zitadel/cli@latest start", "start.jsonl"),
    ("npx @zitadel/cli@latest setup --framework next --server local", "setup.jsonl"),
    ("npm run dev", "dev.jsonl"),
]

# Local paths and addresses from the recording machine, shown generically.
SCRUB = [
    (re.compile(r"/private/tmp/[^\s\x1b]*?/video-run/myapp"), "~/myapp"),
    (re.compile(r"http://192\.168\.\d+\.\d+:3000"), "http://192.168.1.20:3000"),
]

SGR_CLASSES = {30: "k", 31: "r", 32: "g", 33: "y", 34: "bl", 35: "m", 36: "c", 37: "w", 90: "gr", 91: "r", 92: "g", 93: "y", 94: "bl", 95: "m", 96: "c", 97: "w"}


class Term:
    def __init__(self):
        self.rows = [[]]
        self.r = 0
        self.c = 0
        self.style = {"fg": None, "b": False, "d": False}

    def _row(self, r):
        while len(self.rows) <= r:
            self.rows.append([])
        return self.rows[r]

    def put(self, ch, style=None):
        if self.c >= WIDTH:
            self.r += 1
            self.c = 0
        row = self._row(self.r)
        while len(row) < self.c:
            row.append((" ", None))
        cell = (ch, dict(style or self.style))
        if self.c < len(row):
            row[self.c] = cell
        else:
            row.append(cell)
        self.c += 1

    def text(self, s, cls):
        for ch in s:
            if ch == "\n":
                self.r += 1
                self.c = 0
                self._row(self.r)
            else:
                self.put(ch, {"fg": cls, "b": False, "d": False})

    def feed(self, data):
        i = 0
        n = len(data)
        while i < n:
            ch = data[i]
            if ch == "\x1b":
                if re.fullmatch(r"\x1b(\[[?0-9;]*)?", data[i:]):
                    return data[i:]  # split escape: finish it with the next chunk
                m = re.match(r"\x1b\[([?0-9;]*)([A-Za-z])", data[i:])
                if m:
                    self.csi(m.group(1), m.group(2))
                    i += m.end()
                    continue
                m = re.match(r"\x1b\][^\x07]*\x07", data[i:])
                if m:
                    i += m.end()
                    continue
                if i + 1 >= n:
                    return data[i:]  # split escape: keep for the next chunk
                i += 2
                continue
            if ch == "\r":
                self.c = 0
            elif ch == "\n":
                self.r += 1
                self._row(self.r)
            elif ch == "\b":
                self.c = max(0, self.c - 1)
            elif ch >= " ":
                self.put(ch)
            i += 1
        return ""

    def csi(self, params, final):
        if params.startswith("?"):
            return
        nums = [int(p) if p else 0 for p in params.split(";")] if params else []
        n0 = nums[0] if nums else 0
        if final == "m":
            self.sgr(nums or [0])
        elif final == "G":
            self.c = max(0, (n0 or 1) - 1)
        elif final == "K":
            row = self._row(self.r)
            if n0 == 0:
                del row[self.c:]
            elif n0 == 1:
                for k in range(min(self.c + 1, len(row))):
                    row[k] = (" ", None)
            else:
                row.clear()
        elif final == "J":
            row = self._row(self.r)
            del row[self.c:]
            del self.rows[self.r + 1:]
        elif final == "A":
            self.r = max(0, self.r - (n0 or 1))
        elif final == "B":
            self.r += n0 or 1
            self._row(self.r)
        elif final == "C":
            self.c += n0 or 1
        elif final == "D":
            self.c = max(0, self.c - (n0 or 1))

    def sgr(self, nums):
        k = 0
        while k < len(nums):
            p = nums[k]
            if p == 0:
                self.style = {"fg": None, "b": False, "d": False}
            elif p == 1:
                self.style["b"] = True
            elif p == 2:
                self.style["d"] = True
            elif p == 22:
                self.style["b"] = self.style["d"] = False
            elif p == 39:
                self.style["fg"] = None
            elif p in SGR_CLASSES:
                self.style["fg"] = SGR_CLASSES[p]
            elif p == 38 and k + 4 < len(nums) and nums[k + 1] == 2:
                self.style["fg"] = "#%02x%02x%02x" % tuple(nums[k + 2:k + 5])
                k += 4
            k += 1

    def snapshot(self):
        last = max(len(self.rows), self.r + 1)
        start = max(0, last - ROWS)
        out = []
        for row in self.rows[start:last]:
            spans = []
            for ch, st in row:
                key = None
                if st:
                    cls = []
                    if st.get("fg"):
                        cls.append(st["fg"])
                    if st.get("b"):
                        cls.append("b")
                    if st.get("d"):
                        cls.append("d")
                    key = " ".join(cls) or None
                if spans and spans[-1][1] == key:
                    spans[-1][0] += ch
                else:
                    spans.append([ch, key])
            out.append(spans)
        return out


def load(name):
    events = [json.loads(line) for line in open(os.path.join(REC, name))]
    out = []
    for e in events:
        if "o" in e:
            s = e["o"]
            for rx, rep in SCRUB:
                s = rx.sub(rep, s)
            out.append((e["t"], s))
    end = next((e["t"] for e in events if "exit" in e), out[-1][0] if out else 0)
    return out, end


def main():
    term = Term()
    frames = []
    marks = {}

    def snap(t):
        frames.append({"t": round(t, 3), "rows": term.snapshot()})

    def prompt():
        term.text("myapp", "prompt")
        term.text(" $ ", "gr")

    t = 0.0
    prompt()
    snap(-10)
    for idx, (cmd, rec) in enumerate(COMMANDS):
        term.text(cmd, "cmd")
        marks[f"paste{idx}"] = t
        snap(t)
        t += PASTE_TO_ENTER
        term.text("\n", None)
        marks[f"enter{idx}"] = t
        snap(t)
        events, end = load(rec)
        pending = ""
        for et, data in events:
            if rec == "dev.jsonl" and et > DEV_OUTPUT_UNTIL:
                break
            pending = term.feed(pending + data)
            snap(t + et)
        if rec == "dev.jsonl":
            marks["dev_start"] = t
            break
        t += end
        marks[f"exit{idx}"] = t
        if term.c != 0:
            term.text("\n", None)
        prompt()
        snap(t)
        t += READ_PAUSE

    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "terminal.js"), "w") as f:
        f.write("window.TERMINAL = ")
        json.dump({"cols": WIDTH, "rows": ROWS, "marks": marks, "frames": frames}, f, separators=(",", ":"))
        f.write(";\n")
    print(len(frames), "frames;", {k: round(v, 2) for k, v in marks.items()})


if __name__ == "__main__":
    sys.exit(main())
