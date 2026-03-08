# Supabase Setup Guide

## 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project URL and anon key from Project Settings > API

## 2. Set Up Database Schema

1. Open SQL Editor in your Supabase dashboard
2. Copy and paste the contents of `schema.sql`
3. Run the SQL to create all tables and policies

## 3. Configure Authentication

1. Go to Authentication > Providers
2. Enable Email provider
3. Disable "Confirm email" for development (or configure SMTP for production)
4. Magic link is enabled by default

## 4. Deploy Edge Function (Proxy)

```bash
# Install Supabase CLI if not installed
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Deploy the proxy function
supabase functions deploy proxy
```

## 5. Configure Frontend

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 6. Switch to Supabase Provider

Edit `src/data/index.js`:

```javascript
// Comment out Express provider
// export * from './express/index.js';

// Enable Supabase provider
export * from './supabase/index.js';
```

## 7. Build and Deploy Frontend

### Option A: Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel
```

Add environment variables in Vercel dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Option B: Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod
```

Add environment variables in Netlify dashboard.

### Option C: GitHub Pages / Static Host

```bash
# Build
npm run build

# Upload dist/ folder to your static host
```

## Verify Setup

1. Open your deployed app
2. Enter your email to receive magic link
3. Click the link in your email
4. You should be logged in and able to create collections/requests

## Troubleshooting

### "Missing Supabase environment variables"
- Ensure `.env` file exists with correct values
- For Vercel/Netlify, add environment variables in dashboard

### "Invalid or expired token"
- Clear browser localStorage
- Request a new magic link

### CORS errors on proxy
- Ensure the proxy Edge Function is deployed
- Check function logs in Supabase dashboard

### Realtime not working
- Check that tables have Realtime enabled (see schema.sql)
- Verify WebSocket connection in browser DevTools

## Switching Back to Express

To switch back to the Express backend:

1. Edit `src/data/index.js`:
```javascript
export * from './express/index.js';
// export * from './supabase/index.js';
```

2. Start the server: `npm run dev`
