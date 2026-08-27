# ARXYN

## One Sound. Everyone.

ARXYN is a mobile-first synchronized listening experience for shared rooms, realtime chat, collaborative queues, song requests, voting, host controls, and authorized multi-source audio.

## Stack

- React 18
- TypeScript
- Vite
- Supabase client and PostgreSQL migrations
- Supabase Realtime-ready data model
- Lucide icons

## Installation

Requirements: Node.js 18 or newer and npm.

```powershell
npm install
```

Create a local environment file from the template:

```powershell
Copy-Item .env.example .env.local
```

Fill in the public Supabase project values in `.env.local`:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Never put service-role keys, OAuth client secrets, passwords, refresh tokens, or private keys in frontend environment variables or source control.

## Development

```powershell
npm run dev
```

## Production build

```powershell
npm run build
npm run preview
```

The Vite production output is `dist/`. It is generated and ignored by Git.

## Supabase setup

1. Create a Supabase project.
2. Apply the migrations in `supabase/migrations/` using the Supabase SQL editor or Supabase CLI.
3. Configure Authentication providers and redirect URLs in the Supabase dashboard.
4. Enable Realtime for the room tables that will be used by the realtime services.
5. Keep Row Level Security enabled. The migrations define the initial authorization boundary; review policies before public launch.

The frontend client uses only `VITE_SUPABASE_URL` and the public anonymous key. Provider access-token references must be handled by a secure server-side integration and must never be exposed to the browser.

## Google OAuth

Google OAuth is not hard-coded to localhost in this repository. Configure the Google provider in Supabase and add both development and production callback URLs in the Google Cloud console and Supabase Authentication URL Configuration. Use the deployed Vercel URL for production. The current UI preserves the integration boundary; a production Google login action still needs to call Supabase Auth once the project credentials and callback routes are configured.

## Vercel deployment

1. Push this repository to GitHub.
2. Import it into Vercel.
3. Select the Vite framework preset.
4. Use `npm run build` as the build command.
5. Use `dist` as the output directory.
6. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel environment variables for the appropriate environments.
7. Deploy, then add the Vercel production URL to Supabase and Google OAuth redirect configuration.

This app currently uses client-side view state instead of pathname-based routes. No `vercel.json` rewrite is required for the current implementation. Add a SPA rewrite only when URL routes are introduced, and verify it does not hide real server errors.

## Audio source boundaries

ARXYN provides adapter contracts for YouTube, YouTube Music, Amazon Music, device files, and the ARXYN Library. Browser playback must use officially permitted mechanisms. Protected streams must not be extracted, downloaded, scraped, or redistributed. Local files are selected explicitly by the user and are not automatically available to other devices; room sharing requires an authorized media transport and retention policy.

## Before public launch

- Complete Supabase Auth and Google callback implementation.
- Add server-side authorization for provider integrations and token storage.
- Connect Realtime subscriptions and server-authoritative playback services.
- Configure storage, rate limiting, monitoring, backups, privacy, terms, and account deletion.
- Test room capacity, RLS policies, mobile browsers, deep links, and supported audio formats against real infrastructure.
