# Secrets in skills: never shown, never stored

Redact by default (Documentation `engineering/REDACT-BY-DEFAULT-DESIGN.md` §4.7). These rules apply to
every skill that handles a stream key, an invite or hosting link, a token or a password.

1. **One tool stores it.** A secret you capture (a Substack stream key, a co-host invite link) goes to the
   one connector tool that stores it (`set_show_schedule`, `set_show_cohost_invite`) and nowhere else: not
   a report, a chat message, a file, memory, a note or another tool's arguments.
2. **Show `••••` + the last 4.** When a report needs to say a secret was captured, write
   `Stream key: ••••a1b2 (saved)`. For a link, write `invite link saved`.
3. **The connector never hands one back.** `list_schedulable_shows` returns `hasRestreamKey` and
   `restreamKeyTail` instead of the key. Use those to decide; never ask for the full value.
4. **A secret you see by accident stays put.** If a page, a log or a tool result shows a token, password
   or key that isn't one this skill stores, don't repeat it. Say which kind it was and where, and tell the
   member to rotate it if it was theirs.
5. **No secrets in skill text.** `scripts/build-plugin.sh` fails a build whose skill text holds a secret
   pattern, or whose report template prints a secret field such as the full stream key or a token. <!-- secret-scan: allow -->
