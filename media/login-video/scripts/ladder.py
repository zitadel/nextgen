"""Deploy each rung of the brand ladder to a scaffolded app and screenshot its register page.

usage: python3 ladder.py <app dir> [step...]
The app's local Zitadel server and `npm run dev` must be running. Each step
writes the app's config (or its register page), commits it, deploys it with
the CLI, and captures capture/shots/ladder/<step>.png.
"""
import json, os, shutil, subprocess, sys, time

APP = os.path.abspath(sys.argv[1])
VID = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(VID, "capture", "shots", "ladder")
os.makedirs(OUT, exist_ok=True)
ENV = dict(os.environ, ZITADEL_TELEMETRY_ENV="development")
CLI = ["npx", "--yes", "@zitadel/cli@0.9.0"]
EMAIL = "ada.lovelace@example.com"


def gf(family):
    return "https://fonts.googleapis.com/css2?family=" + family.replace(" ", "+") + ":wght@400;600;700&display=swap"


def branding(mode, palette, logo=None, font=None, radius=None):
    side = {"palette": palette}
    if logo:
        side["logo_url"] = f"http://localhost:3000/{logo}"
    b = {"$schema": "../meta/branding.json", "layout": "centered", "liquid_template": {"$file": "./login.liquid"},
         "theme": {"mode": mode, mode: side}}
    if font:
        b["typography"] = {"font_family": font[1], "font_url": gf(font[0])}
    if radius is not None:
        b["shape"] = {"radius": radius}
    return b


# 1. Colours only: the default design, palette changes.
COLORS = {
    "c0-default": branding("dark", {}),
    "c1-violet": branding("dark", {"primary": "#8b5cf6", "on_primary": "#ffffff"}),
    "c2-teal": branding("dark", {"primary": "#2dd4bf", "on_primary": "#042f2e", "background": "#04110f", "surface": "#0a1d1a", "border": "#16403a"}),
    "c3-coral": branding("light", {"primary": "#f2552c", "on_primary": "#ffffff", "background": "#fff3ea", "surface": "#ffffff",
                                   "border": "#f3d9c8", "text": "#24140c", "text_muted": "#8a6a5a"}),
    "c4-indigo": branding("light", {"primary": "#4338ca", "on_primary": "#ffffff", "background": "#eceeff", "surface": "#ffffff",
                                    "border": "#d8dbf7", "text": "#1e1b4b", "text_muted": "#5b5f8a"}),
}
# 2. Fonts, logo and shape.
BRANDS = {
    "b1-fernhill": branding("light", {"primary": "#1f5c3f", "on_primary": "#ffffff", "background": "#eef3ec", "surface": "#ffffff",
                                      "border": "#d5e0d4", "text": "#17301f", "text_muted": "#5d7564", "link": "#1f5c3f"},
                            logo="fernhill.svg", font=("Fraunces", "'Fraunces', Georgia, serif"), radius=14),
    "b2-kiln": branding("light", {"primary": "#e8572a", "on_primary": "#ffffff", "background": "#f6efe7", "surface": "#fffaf4",
                                  "border": "#ead9c8", "text": "#2b1d16", "text_muted": "#7d6656", "link": "#c2461f"},
                        logo="kiln.svg", font=("DM Sans", "'DM Sans', system-ui, sans-serif"), radius=20),
    "b3-signal": branding("dark", {"primary": "#e5ff3a", "on_primary": "#0a0a0a", "background": "#0a0a0a", "surface": "#111111",
                                   "border": "#2e2e2e", "text": "#f2f2f2", "text_muted": "#8c8c8c", "link": "#e5ff3a"},
                          logo="signal.svg", font=("Space Mono", "'Space Mono', ui-monospace, monospace"), radius="none"),
    "b4-halcyon": branding("light", {"primary": "#14213d", "on_primary": "#ffffff", "background": "#eef1f6", "surface": "#ffffff",
                                     "border": "#d7dce6", "text": "#14213d", "text_muted": "#5b6780", "link": "#b8893b"},
                           logo="halcyon.svg", font=("IBM Plex Serif", "'IBM Plex Serif', Georgia, serif"), radius="sm"),
    "b5-orbitly": branding("dark", {"primary": "#f4f1ea", "on_primary": "#121826", "background": "#0b1020", "surface": "#121a2e",
                                    "border": "#24304d", "text": "#f4f1ea", "text_muted": "#9aa6c2", "link": "#ffb15e"},
                           logo="orbitly.svg", font=("Manrope", "'Manrope', system-ui, sans-serif"), radius="lg"),
}
# 4. The whole page: the app's own register page around the widget, in that brand.
# The page carries the logo, so the widget's own logo is dropped.
PAGES = {
    "p1-orbitly": ("b5-orbitly", "orbitly-register-page.tsx"),
    "p2-kiln": ("b2-kiln", "kiln-register-page.tsx"),
}


def run(cmd):
    return subprocess.run(cmd, cwd=APP, env=ENV, capture_output=True, text=True)


def write_json(rel, obj):
    with open(os.path.join(APP, rel), "w") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")


def deploy(msg, paths):
    run(["git", "add", *paths])
    run(["git", "commit", "-qm", msg, "--", *paths])
    t0 = time.time()
    d = run([*CLI, "deploy", "-m", msg, "--non-interactive", "--json"])
    out = d.stdout.strip()
    status = json.loads(out).get("status") if out.startswith("{") else (d.stderr or out)[-400:]
    return status, time.time() - t0


def capture(name, values=(EMAIL,), path="/register"):
    c = subprocess.run(["node", os.path.join(VID, "scripts", "capture-ladder.mjs"), os.path.join(OUT, f"{name}.png"), path, *values],
                       capture_output=True, text=True)
    return c.stdout.strip() or c.stderr[-400:]


REGISTER = os.path.join(APP, "app", "register", "page.tsx")
ORIGINAL = open(REGISTER).read()
# the fictional brands' logos, served by the app
LOGOS = os.path.join(VID, "capture", "app", "public")
for logo in os.listdir(LOGOS):
    shutil.copy(os.path.join(LOGOS, logo), os.path.join(APP, "public", logo))

steps = sys.argv[2:] or [*COLORS, *BRANDS, *PAGES, "f1-fields"]
for name in steps:
    if name in COLORS or name in BRANDS:
        write_json(".zitadel/branding/branding.json", (COLORS | BRANDS)[name])
        status, dt = deploy(f"style: {name}", [".zitadel/branding"])
        print(name, "deploy", status, f"{dt:.1f}s", capture(name))
    elif name in PAGES:
        brand, page = PAGES[name]
        b = json.loads(json.dumps(BRANDS[brand]))
        b["theme"][b["theme"]["mode"]].pop("logo_url", None)
        write_json(".zitadel/branding/branding.json", b)
        status, dt = deploy(f"style: {brand}", [".zitadel/branding"])
        shutil.copy(os.path.join(VID, "capture", "app", page), REGISTER)
        time.sleep(2.5)  # let the dev server pick up the page
        print(name, "deploy", status, f"{dt:.1f}s", capture(name))
        open(REGISTER, "w").write(ORIGINAL)
        time.sleep(1.5)
    elif name == "f1-fields":
        # 3. Fields: the sign-up asks for a name and a company too (Fernhill brand).
        write_json(".zitadel/branding/branding.json", BRANDS["b1-fernhill"])
        schema_path = ".zitadel/schemas/default-human-user.json"
        flow_path = ".zitadel/flows/default-login.json"
        schema = json.load(open(os.path.join(APP, schema_path)))
        schema["properties"]["name"] = {"type": "string", "title": "Full name"}
        schema["properties"]["company"] = {"type": "string", "title": "Company"}
        write_json(schema_path, schema)
        flow = json.load(open(os.path.join(APP, flow_path)))
        for st in flow["steps"]:
            if st["name"] == "register":
                st["fields"] = ["name", "email", "company"]
        write_json(flow_path, flow)
        status, dt = deploy("feat: ask for name and company at sign-up", [".zitadel"])
        print(name, "deploy", status, f"{dt:.1f}s", capture(name, values=("Ada Lovelace", EMAIL, "Fernhill Analytical")))
    else:
        print("unknown step", name)
