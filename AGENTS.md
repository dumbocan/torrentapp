# AGENTS.md

## Overview
- Node/Express app with `server.js` as the main entrypoint.
- Includes Tailwind-based frontend assets built from `src/styles/tailwind.css`.
- Uses Axios directly in the server for external HTTP requests.

## Dev commands
- Install: `npm install`
- Start server: `npm start`
- Dev server: `npm run dev`
- Build CSS: `npm run build`
- Watch CSS: `npm run dev:css`

## Working rules
- Be careful with external request behavior in `server.js`; avoid changing timeouts, headers, or scraping/request logic casually.
- Keep server and frontend edits scoped to the task.
- Avoid broad dependency churn unless explicitly requested.
- Axios is pinned exactly; do not loosen it back to a ranged version without a reason.

## Validation
- For backend behavior changes, run the most relevant local smoke test you can.
- For styling changes, rebuild CSS.
- For dependency/config changes, verify `package.json`, `package-lock.json`, and `.npmrc` stay aligned.
