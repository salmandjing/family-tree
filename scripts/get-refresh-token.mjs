#!/usr/bin/env node
/**
 * One-time helper to obtain a Google OAuth **refresh token** for the backup
 * Worker (scope: drive.file). No dependencies — uses Node's built-in http.
 *
 * Prerequisites (see README "Backup Worker" section):
 *   - A Google Cloud OAuth 2.0 Client (type: Web application).
 *   - The redirect URI below registered on that client:
 *         http://localhost:53682
 *   - The OAuth consent screen published to "Production" (avoids the 7-day
 *     refresh-token expiry of Testing mode).
 *
 * Usage:
 *   node scripts/get-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
 * or with env vars:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/get-refresh-token.mjs
 *
 * It prints an authorization URL, waits for you to approve in the browser,
 * then prints the refresh token to paste into `wrangler secret put
 * GOOGLE_REFRESH_TOKEN`.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const clientId = process.argv[2] || process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.argv[3] || process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    'Usage: node scripts/get-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>\n' +
      '   or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the environment.',
  );
  process.exit(1);
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // request a refresh token
    prompt: 'consent', // force a refresh token even on re-auth
  }).toString();

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* user can open it manually */
  }
}

async function exchangeCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
    res.writeHead(404).end();
    return;
  }

  const error = url.searchParams.get('error');
  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
    console.error(`\n❌ Authorization failed: ${error}`);
    server.close();
    process.exit(1);
  }

  try {
    const tokens = await exchangeCode(url.searchParams.get('code'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<h1>✅ All set</h1><p>You can close this tab and return to the terminal.</p>',
    );

    if (!tokens.refresh_token) {
      console.error(
        '\n⚠️  No refresh_token returned. This usually means you have authorized ' +
          'before. Revoke access at https://myaccount.google.com/permissions and ' +
          'run this again.',
      );
      server.close();
      process.exit(1);
    }

    console.log('\n✅ Success! Set this as the Worker secret GOOGLE_REFRESH_TOKEN:\n');
    console.log(tokens.refresh_token);
    console.log(
      '\n   cd worker && npx wrangler secret put GOOGLE_REFRESH_TOKEN\n' +
        '   (paste the value above when prompted)\n',
    );
    server.close();
    process.exit(0);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error</h1><pre>${e.message}</pre>`);
    console.error(`\n❌ ${e.message}`);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('\nGoogle refresh-token helper');
  console.log('───────────────────────────');
  console.log(`Listening on ${REDIRECT_URI}`);
  console.log('\n1. Make sure this exact redirect URI is registered on your OAuth client:');
  console.log(`     ${REDIRECT_URI}`);
  console.log('\n2. Opening your browser to authorize (sign in as the Drive owner)…');
  console.log('   If it does not open, paste this URL manually:\n');
  console.log(`   ${authUrl}\n`);
  openBrowser(authUrl);
});
