# chatmap

Chrome extension that adds a small timeline/minimap to ChatGPT conversations so long chats are easier to jump through and bookmark.

## Install

### 1. Clone the repo

```bash
git clone https://github.com/jacobkobr/chatmap.git
cd chatmap
```

### 2. Install dependencies

```bash
pnpm install
```

If `pnpm` is not installed, enable it with Corepack:

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

Or install it globally:

```bash
npm install -g pnpm
```

### 3. Build the extension

```bash
pnpm build
```

This creates a `dist` folder.

### 4. Load it in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` folder from this repo
5. Refresh ChatGPT

chatmap should now appear on ChatGPT conversations.

## Usage

Hover over a marker to preview the message.

Click a marker to jump to that message.

Bookmark a message by hovering over its marker and using:

```text
Alt + Shift + Click
```

Jump to the previous bookmark:

```text
Alt + Shift + W
```

Toggle bookmarks-only view:

```text
Alt + Shift + H
```

Jump to the next bookmark:

```text
Alt + Shift + S
```

Export chat:

```text
Alt + Shift + E
```

Scroll through messages one at a time:

```text
Alt + Shift + Scroll
```

You can change shortcut settings from the extension popup.
