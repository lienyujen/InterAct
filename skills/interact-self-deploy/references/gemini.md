# Gemini Deployment

Create an API key in Google AI Studio under the instructor's own Google account. Confirm the account's quota and billing policy. The key must exist only in Supabase Edge Function secrets.

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\skills\interact-self-deploy\scripts\deploy-gemini.ps1 -ProjectRef YOUR_PROJECT_REF
```

The script securely prompts for the API key, sets `GEMINI_API_KEY` and `GEMINI_MODEL`, deletes its temporary secret file, and deploys all six AI functions. The default model is `gemini-3.6-flash`; override it with `-Model MODEL_NAME` only after verifying availability in that Google AI Studio project.

## Checkpoint

Create a session, dispatch a screenshot question, stop answering, and confirm AI analysis appears. Also generate an Exit Ticket. A deployed function alone is not proof that the key, model, quota, and response schema work together.
