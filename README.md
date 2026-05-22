# Chat Timeline

Chrome extension that adds a small timeline/minimap to ChatGPT conversations so long chats are easier to jump through and bookmark.

## Install

Pull the repo and build:

```bash
git pull
pnpm install
pnpm build
```

Then load it in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` folder
5. Refresh ChatGPT

## Usage

Hover over a marker to preview a message.

Click a marker to jump to that message.

While hovering over a marker on the map, bookmark that message with:

```text
Alt + Shift + Click
```

Jump to previous bookmark:

```text
Alt + Shift + W
```

Jump to next bookmark:

```text
Alt + Shift + S
```
