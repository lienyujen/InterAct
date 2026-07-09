You are developing InterAct, a GitHub Pages deployable web app.

InterAct stands for Intelligent Teaching, Engagement, Response and Classroom Technology.

The app is a real-time classroom interaction system. It uses React, TypeScript, Vite, Supabase Database, Supabase Realtime, Supabase Storage, and Supabase Edge Functions.

Do not build an Electron app.
Do not build a local network server.
Do not assume participants are on the same Wi-Fi.

The app must work across domains through a deployed web URL.
Use GitHub Pages for frontend deployment.
Use HashRouter for routing.
Use Supabase for realtime database and storage.
Use Supabase Edge Functions for AI API calls.
Never expose AI API keys in frontend code.

Core features:

- Presenter creates a session.
- Presenter sees QR Code.
- Participants scan QR Code and enter name.
- Names are required and stored.
- Messages appear as real-time danmaku from right to left.
- Anonymous mode is on by default.
- Presenter can turn anonymous mode off.
- Danmaku is not moderated.
- Presenter can turn danmaku on or off.
- Presenter can upload or capture a screen image and send it to participants.
- Presenter can create polls, multiple-choice questions, true-false questions, and short-answer questions.
- Participants cannot modify answers after submission.
- Presenter can stop answering.
- Presenter manually selects correct answers for multiple-choice and true-false questions.
- The system calculates correct and incorrect percentages.
- Short answers are summarized by AI.
- Exit Ticket summarizes the whole session.
- CSV export is required.

Build in phases. Keep the app simple and working before adding polish.
