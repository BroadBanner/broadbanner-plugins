#!/usr/bin/env bash
# install-session-prune.sh — keep LOCAL scheduled-task sessions from crashing the
# Claude desktop app.
#
# Every scheduled task that runs on this computer leaves a Cowork session behind
# (a ~350 KB local_<id>.json plus a local_<id>/ folder). The desktop app loads
# every one of those .json files at launch; ~21k of them (Sept 2026, from the
# release pollers) ran V8 out of memory and the app crashed on open. This installs
# a launchd agent that deletes FINISHED scheduled-task sessions older than N days.
# Your own (manual) Cowork chats are never touched — only sessions that carry a
# scheduledTaskId.
#
# Run in Terminal on the Mac (NOT inside Cowork — its sandbox can't reach
# ~/Library):
#   bash install-session-prune.sh             # install (prune >3 days, every 6h)
#   bash install-session-prune.sh --days 7    # keep a week instead
#   bash install-session-prune.sh --dry-run   # show what would be pruned now; install nothing
#   bash install-session-prune.sh --uninstall # remove the agent + script
set -euo pipefail

LABEL="com.broadbanner.prune-cowork-sessions"
BIN_DIR="$HOME/.broadbanner/bin"
SCRIPT="$BIN_DIR/prune-cowork-sessions.py"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/broadbanner-session-prune.log"
DAYS=3
MODE=install

while [ $# -gt 0 ]; do
  case "$1" in
    --days) DAYS="$2"; shift 2 ;;
    --dry-run) MODE=dry-run; shift ;;
    --uninstall) MODE=uninstall; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$DAYS" in ''|*[!0-9]*) echo "--days must be a whole number" >&2; exit 2 ;; esac

if [ "$(uname)" != "Darwin" ]; then
  echo "This installs a macOS launchd agent; run it on the Mac that runs Claude desktop." >&2
  exit 1
fi

if [ "$MODE" = uninstall ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$SCRIPT"
  echo "Removed $LABEL."
  exit 0
fi

mkdir -p "$BIN_DIR"
cat > "$SCRIPT" <<'PY'
#!/usr/bin/env python3
"""Delete finished Cowork scheduled-task sessions older than --days.

Only touches <root>/<account>/<org>/local_*.json whose JSON has a scheduledTaskId,
plus that session's own local_<id>/ folder. Never touches manual chats.
"""
import argparse, json, os, shutil, sys, time
from datetime import datetime

ROOT = os.path.expanduser("~/Library/Application Support/Claude/local-agent-mode-sessions")

def last_active(d, path):
    for key in ("lastActivityAt", "createdAt"):
        v = d.get(key)
        if isinstance(v, (int, float)):
            return v / 1000 if v > 1e12 else v
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
            except ValueError:
                pass
    return os.path.getmtime(path)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=float, default=3)
    ap.add_argument("--apply", action="store_true", help="delete (default: dry run)")
    a = ap.parse_args()
    if not os.path.isdir(ROOT):
        print(f"{ROOT} not found; nothing to do")
        return
    cutoff = time.time() - a.days * 86400
    kept = pruned = freed = 0
    for acct in os.listdir(ROOT):
        if acct == "skills-plugin":
            continue
        acct_dir = os.path.join(ROOT, acct)
        if not os.path.isdir(acct_dir):
            continue
        for org in os.listdir(acct_dir):
            org_dir = os.path.join(acct_dir, org)
            if not os.path.isdir(org_dir):
                continue
            for name in os.listdir(org_dir):
                if not (name.startswith("local_") and name.endswith(".json")):
                    continue
                path = os.path.join(org_dir, name)
                try:
                    with open(path) as f:
                        d = json.load(f)
                except (OSError, ValueError):
                    continue
                if not d.get("scheduledTaskId"):
                    continue  # a manual chat: never touch
                if last_active(d, path) > cutoff:
                    kept += 1
                    continue
                # The session's folder: local_<id>/ next to the .json (also its cwd).
                folder = os.path.realpath(os.path.join(org_dir, name[:-5]))
                size = os.path.getsize(path)
                if os.path.isdir(folder):
                    for dp, _, fs in os.walk(folder):
                        for fn in fs:
                            try:
                                size += os.path.getsize(os.path.join(dp, fn))
                            except OSError:
                                pass
                pruned += 1
                freed += size
                if a.apply:
                    os.remove(path)
                    # Safety: only remove a folder that sits directly inside org_dir.
                    if os.path.isdir(folder) and os.path.dirname(folder) == os.path.realpath(org_dir):
                        shutil.rmtree(folder, ignore_errors=True)
    verb = "pruned" if a.apply else "would prune"
    print(f"{datetime.now().isoformat(timespec='seconds')} {verb} {pruned} scheduled-task "
          f"session(s) older than {a.days:g}d ({freed / 1e6:.0f} MB); kept {kept} recent")

if __name__ == "__main__":
    sys.exit(main())
PY
chmod 755 "$SCRIPT"

if [ "$MODE" = dry-run ]; then
  /usr/bin/python3 "$SCRIPT" --days "$DAYS"
  rm -f "$SCRIPT"
  exit 0
fi

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$SCRIPT</string>
    <string>--days</string><string>$DAYS</string>
    <string>--apply</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>21600</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: prunes scheduled-task sessions older than ${DAYS}d at login and every 6h."
echo "Log: $LOG    Remove: bash $0 --uninstall"
