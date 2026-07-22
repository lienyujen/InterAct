# Reurl.cc Deployment

Obtain a Reurl.cc API key under the instructor's own account. The shortener is separate from GitHub Pages: GitHub hosts the participant app, while Reurl only produces a compact link to that app.

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\deploy-reurl.ps1 -ProjectRef YOUR_PROJECT_REF
```

The script securely stores `REURL_API_KEY` as a Supabase secret and deploys only `shorten-url`. Without this phase, InterAct continues to work and displays the full GitHub Pages URL.

## Checkpoint

Create a new session after deployment. The QR panel should change from the full GitHub Pages join URL to a `https://reurl.cc/...` URL. Existing sessions cache `short_join_url`; use a new session when testing a changed key.
