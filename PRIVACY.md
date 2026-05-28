# chatmap — Privacy Policy

_Last updated: 2026-05-27_

chatmap is a Chrome extension that adds a minimap/timeline to ChatGPT
conversations. This policy explains exactly what data the extension touches
and where it goes. The short version: **everything stays on your own device.
chatmap has no servers, sends nothing anywhere, and contains no analytics or
tracking.**

## What chatmap accesses

chatmap runs only on `chatgpt.com` and `chat.openai.com`. On those pages it:

- **Reads the content of the conversation you are viewing** so it can build
  the rail of markers, hover previews, and feature badges. It reads the
  on-page messages and, to show full history without scrolling, requests the
  current conversation from ChatGPT's own API
  (`/backend-api/conversation/{id}`), authorized with the access token from
  your existing ChatGPT session (`/api/auth/session`). These requests go to
  ChatGPT's own backend, on the same origin you are already signed in to.
  chatmap does not send your token or conversation anywhere else.

## What chatmap stores

chatmap stores the following in `chrome.storage.local` **on your device only**:

- **Settings** — your preferences (accent color, shortcuts, which markers to
  show, etc.).
- **Bookmarks** — for messages you bookmark: an optional label, note, color,
  timestamp, and an identifier for the message they attach to.
- **A local marker cache** — short text previews of messages, their length,
  detected features (e.g. contains code/link/image), and position identifiers,
  so the rail loads instantly when you reopen a conversation.

This data never leaves your browser. It is not transmitted to the developer or
any third party, and it is not sold or shared. Removing the extension removes
this data; you can also clear it from the extension's settings or your
browser's site/extension data controls.

## What chatmap does **not** do

- No remote servers operated by chatmap, and no data sent to the developer.
- No analytics, telemetry, advertising, or tracking.
- No remotely hosted or executed code — all logic ships inside the extension.
- No access to any site other than ChatGPT.

## Permissions

- `storage` — to save your settings, bookmarks, and the local marker cache.
- Host access to `chatgpt.com` / `chat.openai.com` — to read the conversation
  and render the minimap on those pages.
