# bb-distro authentication — RETIRED

> **This reference is no longer in use.** The HMAC-bearer authentication scheme
> it described has been removed from `substack-note` in favor of gateway-only
> capability tokens (see `../SKILL.md` § "Step 0.5: Load gateway credentials").
>
> Do **not** sign requests against `api.broadbanner.com` from this skill. Do
> **not** read `BROADBANNER_ENC_PASSPHRASE`. Do **not** construct
> `<ts>.<routeTag>.<bodyHashHex>.<hmacHex>` tokens.
>
> The substack-note skill now talks exclusively to `gateway.broadbanner.com`
> with `Authorization: Bearer <GATEWAY_TOKEN>`, where the token is read from
> `<PROJECT_ROOT>/.creds/gateway.token` provisioned by `banner-blast init` or
> `banner-admin init`.
>
> If you arrived here from a different skill in this plugin (social-push,
> substack-video-note, substack-schedule-live, etc.) that still uses
> HMAC: those skills have not yet been migrated. Track that work against the
> Gateway-Worker BFF cutover. Do not copy the HMAC pattern back into
> substack-note — it has been deliberately removed.
>
> The previous contents of this file, including the full Bearer-HMAC token
> shape, the per-route signing examples, and the multipart edge case, are
> available in git history. Recover them with:
>
> ```
> git log --diff-filter=D --summary -- \
>   Plugins/broadbanner-social-distribution/skills/substack-note/references/bb-distro-auth.md
> ```
>
> followed by `git show <commit>~:<path>` against the last commit that
> contained the HMAC text.
