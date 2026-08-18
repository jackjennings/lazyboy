When the change alters what a user sees, capture before/after evidence and embed
it in the description. A sentence describing what a reviewer would have seen is
not evidence.

Check for the capture tool before planning any of this:

```
command -v agent-browser
```

If that prints nothing the tool is unavailable on this host — skip capture and
do not install it. When it is present:

1. Serve the application the way this repository documents. If no documented way
   to run it exists, or it cannot run without credentials or services you do not
   have, skip capture.
2. `agent-browser open <url>`, then drive the UI to the state the change
   affects. `agent-browser snapshot -i` lists interactive elements as `@eN`
   refs; `agent-browser click @e1` and `agent-browser fill @e2 "text"` take
   those refs.
3. Capture the after state: `agent-browser screenshot /tmp/<slug>-after.png`.
   Use video only when the change is in the transition rather than the end state
   — `agent-browser record start /tmp/<slug>-after.webm`, drive the UI, then
   `agent-browser record stop`.
4. Capture the before state from the base revision, never from uncommitted work.
   Your changes are already committed at this point: confirm
   `git status --porcelain` is empty,
   `git switch --detach origin/<base branch>`, restart or reload the
   application, capture to `/tmp/<slug>-before.png`, then `git switch -` to
   return to the ticket branch. Omit the before capture when the change adds a
   surface that did not previously exist.
5. Upload each file and embed the URL it returns. There is no documented GitHub
   API for this; the endpoint below is undocumented but accepts the token
   already present in your environment:

```
REPO_ID=$(gh api repos/<owner>/<repo> --jq .id)
curl -s -X POST \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/json" \
  --data-binary "@/tmp/<slug>-after.png" \
  "https://uploads.github.com/user-attachments/assets?name=after.png&content_type=image/png&repository_id=$REPO_ID"
```

The response is `{"url":"https://github.com/user-attachments/assets/<uuid>"}`.
Embed an image as `<img src="<url>" width="900" alt="<what it shows>" />` and a
video as the bare URL on a line of its own. If the response is not a URL, do not
retry with a different endpoint — treat capture as unavailable and fall back.

An uploaded asset is readable by everyone who can read the repository. Never
capture real customer data; use synthetic or test data only.

Fall back when the tool is absent, the application cannot be served here, the
upload fails, or the change has no user-visible effect: write a single line in
that section stating that, and delete any before/after table the template
provides. Never substitute prose for the artifact — a table holding sentences
where images belong reads as a fabricated screenshot.
