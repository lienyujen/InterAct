# Supabase Deployment

Use a new, empty Supabase project. In Supabase Project Settings, record:

- Project ref: the 20-character identifier in the project URL.
- Project URL: `https://PROJECT_REF.supabase.co`.
- Publishable key: the `sb_publishable_...` value.

Never use the dashboard URL as the Project URL. Never place the secret key or legacy service-role key in frontend configuration.

## Deploy

1. Install Node.js 24 and pnpm.
2. From the InterAct repository root, run `pnpm dlx supabase login` and complete browser authentication.
3. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\deploy-supabase.ps1 -ProjectRef YOUR_PROJECT_REF
```

The script executes `supabase/schema.sql`, creates the `interact-screenshots` public bucket, enables Realtime tables, and deploys `create-session`, `participant-action`, and `presenter-action`.

## Checkpoint

In Supabase, verify that `sessions`, `participants`, `questions`, `answers`, `messages`, `session_events`, and the other InterAct tables exist. Verify the Storage bucket and three Edge Functions exist. Stop if any step failed; do not continue with a partially initialized project.
