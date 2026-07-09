# Phase 2: Windows Presenter, Screenshot Questions, and AI Analysis

## Architecture

InterAct now uses two presenter surfaces:

- Participant app: GitHub Pages web app for phones and tablets.
- Presenter app: Windows desktop app powered by Electron, React, Vite, and Supabase.

Both surfaces share the same Supabase project:

- Database: sessions, participants, messages, screenshots, questions, answers, summaries.
- Realtime: messages, participants, questions, answers, screenshots.
- Storage: `interact-screenshots`.
- Edge Functions: AI screen preview, short answer summary, exit ticket summary.

The participant side stays web-first. The Windows app exists because browser pages cannot reliably capture the full Windows screen or other apps such as PowerPoint without extra permission and browser limitations.

## Windows Presenter MVP

The first Windows presenter version wraps the existing React presenter page in Electron.

Desktop-only features are exposed through `window.interactDesktop`:

- `captureFirstScreen()`: captures the primary screen thumbnail.
- `listCaptureSources()`: lists screens and windows for a future source picker.

The captured image is converted to a PNG file in the renderer and sent through the same upload flow as manual image upload:

1. Capture screen.
2. Upload PNG to Supabase Storage.
3. Insert `screenshots` record.
4. Create or update an active `send_screen` question.
5. Update `sessions.current_question_id`.
6. Participant page receives realtime updates and shows the image.

## Screenshot Question Flow

The desired teaching flow:

1. Presenter clicks `Windows 截圖派送`.
2. Windows app captures the screen or selected window.
3. Presenter optionally chooses a question type:
   - send screen only
   - poll
   - multiple choice
   - true/false
   - short answer
4. Screenshot uploads to Storage.
5. Screenshot record is inserted with `ai_status = pending`.
6. `ai-screen-preview` reads the image and writes `screenshots.screen_summary`.
7. A question is created and pushed to participants.
8. Participants answer.
9. Presenter stops the question.
10. Results and AI summaries are displayed.

## AI API Boundary

AI keys must never be stored in frontend code or Electron renderer code.

All AI calls go through Supabase Edge Functions. Required secrets:

- `AI_API_KEY`
- `AI_API_ENDPOINT`
- `AI_MODEL`

The functions are designed around OpenAI-compatible chat completion APIs. If a different vendor is used later, only Edge Functions should change.

## Short Answer AI Summary

Input:

- question title
- screenshot summary, if available
- all submitted short answers

Output:

```json
{
  "overall_summary": "整體作答摘要",
  "main_response_types": [
    {
      "type": "答案類型",
      "description": "說明",
      "approx_percentage": "估計比例"
    }
  ],
  "common_misunderstandings": ["誤解1", "誤解2"],
  "representative_answers": ["代表性答案1", "代表性答案2"],
  "teaching_suggestions": ["講者可以追問或補充的方向1", "方向2"],
  "understanding_level": "高 | 中 | 低 | 無法判斷"
}
```

## Next Implementation Steps

1. Add a screenshot source picker instead of always capturing the first screen.
2. Let the presenter choose a question type immediately after capture.
3. Implement short answer question creation and participant answer UI.
4. Call `ai-short-answer-summary` after the presenter stops a short answer question.
5. Display AI summary in `QuestionResult`.
6. Add Exit Ticket UI and `ai-exit-ticket-summary`.
7. Package the Electron app into a Windows installer.
