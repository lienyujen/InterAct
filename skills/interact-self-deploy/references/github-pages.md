# GitHub Pages Deployment

Fork or copy InterAct into the instructor's own GitHub repository. Install and authenticate GitHub CLI with `gh auth login`. GitHub Pages requires a public repository on free accounts; private-repository availability depends on the account plan.

The final URL normally uses `https://OWNER.github.io/REPOSITORY`. Use that exact URL as `VITE_PUBLIC_APP_URL`; do not append `/#/join/...`.

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\configure-github-pages.ps1 `
  -Repository OWNER/REPOSITORY `
  -SupabaseUrl https://PROJECT_REF.supabase.co `
  -PublishableKey sb_publishable_xxx `
  -PublicAppUrl https://OWNER.github.io/REPOSITORY
```

The script stores only public frontend configuration as GitHub Actions variables, enables Pages workflow mode when GitHub permits it, and starts `.github/workflows/deploy.yml`. Gemini and Reurl keys never belong in GitHub Pages variables.

## Checkpoint

Wait for the `Deploy to GitHub Pages` workflow to pass. Open the final URL and confirm the join route uses the new Supabase project. If the workflow is disabled on a fork, enable Actions and select `GitHub Actions` under Repository Settings > Pages before rerunning it.
