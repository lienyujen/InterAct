# InterAct 即時互動教學系統

InterAct stands for Intelligent Teaching, Engagement, Response and Classroom Technology.

InterAct is a real-time classroom interaction web app for teachers, speakers, trainers, and workshop facilitators. It allows presenters to create a live session, show a QR Code, receive audience questions as danmaku, send screenshots, launch polls and questions, collect answers, summarize short responses with AI, and generate an Exit Ticket summary.

This version is a GitHub Pages deployable web app using:

- React
- TypeScript
- Vite
- Supabase Database
- Supabase Realtime
- Supabase Storage
- Supabase Edge Functions

## Current MVP

- Presenter creates a session.
- Presenter sees a QR Code and join URL.
- Participant joins with a required name.
- Participant sends messages.
- Presenter sees right-to-left danmaku.
- Presenter can turn danmaku on or off.
- Presenter can turn anonymous mode on or off.
- Presenter can upload an image and send it to participants.
- Presenter can create a multiple-choice question.
- Participant can answer once.
- Presenter can stop answering and select the correct answer.
- Presenter sees answer counts and correct/incorrect percentages.

## Local Setup

1. Install dependencies.

```bash
pnpm install
```

2. Create `.env` from `.env.example`.

```bash
cp .env.example .env
```

3. Create a Supabase project and run `supabase/schema.sql` in the SQL editor.

4. Create a public Supabase Storage bucket named `interact-screenshots`.

5. Start the dev server.

```bash
pnpm dev
```

## Windows Presenter App

The participant app remains available on GitHub Pages. The presenter can also run a Windows desktop app for screen capture.

```bash
pnpm desktop:dev
```

The desktop app opens the presenter flow and adds `Windows 截圖派送` on the presenter control panel. Captured images use the same Supabase Storage and Realtime flow as uploaded images.

## Build

```bash
pnpm build
```

The app uses `HashRouter`, so GitHub Pages refreshes do not 404.
