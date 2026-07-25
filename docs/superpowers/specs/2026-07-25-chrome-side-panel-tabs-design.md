# Chrome Side Panel Tabs Extension Design

## Summary

Build a Chrome Manifest V3 extension that provides an Edge-like left-side tab list through Chrome's official Side Panel API. The first release prioritizes performance, low permissions, store-readiness, and a narrow feature set: view, search, switch, and close tabs in the current Chrome window.

The extension does not replace Chrome's native top tab strip, inject UI into webpages, collect browsing data, or use remote code.

## Goals

- Provide a persistent side panel showing tabs from the current Chrome window.
- Make common tab actions fast: search, switch, close, and visually identify the active or pinned tab.
- Keep startup, memory, and runtime overhead low.
- Use the smallest practical permission set for Chrome Web Store review.
- Create a simple architecture that can later support richer Edge-like behavior without rewriting the extension.

## Non-goals for the MVP

- Replacing or hiding Chrome's native top tab strip.
- Injecting a floating sidebar into every webpage.
- Tab suspension, freezing, or memory management.
- Cloud sync, accounts, telemetry, analytics, or server communication.
- Session restore, workspaces, or cross-device state.
- Complex tab grouping, tree tabs, or automatic domain clustering.
- A React, Vue, or heavy UI framework implementation.

## Product behavior

The user opens the extension's side panel from the extension icon or Chrome's side panel controls. The panel shows a compact vertical list of tabs in the current window.

Each tab row includes:

- Favicon or a fallback marker.
- Page title, with ellipsis for overflow.
- Domain or shortened URL.
- Active state indicator.
- Pinned state indicator when applicable.
- Close button.

Supported MVP interactions:

- Click a tab row to activate that tab.
- Click the close button to close a tab.
- Type in the search input to filter tabs by title, URL, or domain.
- See tab updates reflected when tabs are created, removed, activated, moved, or updated.
- Use basic keyboard navigation from the search field if implementation cost stays low.

## Recommended implementation approach

Use:

- Manifest V3.
- Chrome Side Panel API.
- Vanilla TypeScript.
- Native DOM rendering.
- Plain CSS.
- A small build pipeline only if needed for TypeScript bundling.

Avoid:

- Content scripts.
- Host permissions such as `<all_urls>`.
- Remote JavaScript.
- Long-running polling.
- Large component frameworks in the MVP.

This keeps the extension small, predictable, and easy to explain during Chrome Web Store review.

## Extension structure

```text
manifest.json
src/
  background/
    service-worker.ts
  sidepanel/
    index.html
    sidebar.ts
    sidebar.css
    tab-store.ts
    tab-renderer.ts
    tab-actions.ts
```

### `manifest.json`

Declares the MV3 extension, side panel entry, service worker, action icon, and minimal permissions.

Initial permissions:

- `sidePanel`: display the side panel UI.
- `tabs`: read and manage browser tabs.

Avoid `storage` until there is a real persisted setting. Avoid host permissions in the MVP.

### `src/background/service-worker.ts`

Responsibilities:

- Configure the extension action to open the side panel.
- Keep background work minimal.
- Avoid storing tab snapshots in the service worker.

The service worker should not be the source of truth for tab state because MV3 service workers are event-driven and may stop between events.

### `src/sidepanel/sidebar.ts`

Responsibilities:

- Initialize side panel UI.
- Query tabs for the current window when the panel loads.
- Wire Chrome tab events to the tab store.
- Wire UI events such as search input and clicks.
- Coordinate rendering without owning all low-level DOM details.

### `src/sidepanel/tab-store.ts`

Responsibilities:

- Maintain tab state in memory while the side panel is open.
- Use a `Map<number, TabViewModel>` keyed by tab ID.
- Track current active tab ID and current search query.
- Expose simple methods for initialize, add, update, remove, move, activate, and filter.

The store is intentionally in-memory. Rebuild it from `chrome.tabs.query` whenever the side panel opens.

### `src/sidepanel/tab-renderer.ts`

Responsibilities:

- Render the tab list.
- Update individual tab rows when possible.
- Avoid full-list redraws for small tab updates.
- Use `DocumentFragment` for initial render and large filtered render.

For the MVP, a full redraw after search is acceptable if it stays fast for at least 100 tabs. Incremental row updates should be used for common tab events such as title, favicon, active state, and close.

### `src/sidepanel/tab-actions.ts`

Responsibilities:

- Wrap Chrome tab operations:
  - `chrome.tabs.update(tabId, { active: true })`
  - `chrome.tabs.remove(tabId)`
  - optional future `chrome.tabs.move`
- Normalize errors from closed or unavailable tabs.

## Data model

```ts
type TabViewModel = {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  domain: string;
  favIconUrl?: string;
  active: boolean;
  pinned: boolean;
};
```

Only fields required for rendering and MVP actions should be stored.

## Data flow

1. Side panel loads.
2. `sidebar.ts` calls `chrome.windows.getCurrent()` and `chrome.tabs.query({ windowId })`.
3. `tab-store.ts` creates an in-memory tab map.
4. `tab-renderer.ts` renders the current list.
5. Chrome tab events update the store.
6. Renderer patches affected rows or redraws the filtered list.
7. User actions call `tab-actions.ts`, then Chrome tab events reconcile final state.

## Event handling

Listen while the side panel page is open:

- `chrome.tabs.onCreated`
- `chrome.tabs.onRemoved`
- `chrome.tabs.onUpdated`
- `chrome.tabs.onActivated`
- `chrome.tabs.onMoved`
- `chrome.tabs.onAttached`
- `chrome.tabs.onDetached`

Each event should ignore tabs outside the panel's current window unless cross-window support is intentionally added later.

## Performance requirements

Target behavior:

- Side panel becomes interactive in under 100 ms after its HTML loads on a typical modern machine.
- Smooth list interaction with 100 tabs.
- No content script overhead on webpages.
- No polling loops.
- No network requests.
- No framework hydration cost.

Implementation rules:

- Initialize only when the side panel page opens.
- Keep service worker work minimal.
- Use event-driven tab updates.
- Debounce search input by roughly 80-120 ms.
- Normalize strings for search once per tab update rather than on every keystroke if needed.
- Use event delegation for tab row clicks instead of one listener per button where practical.
- Avoid storing large tab history or snapshots.

## Privacy and Chrome Web Store readiness

The MVP should make these claims true:

- The extension does not collect user data.
- The extension does not transmit browsing history, tab titles, or URLs.
- The extension does not use analytics.
- The extension does not execute remotely hosted code.
- The extension only requests permissions required for side panel tab management.

The Chrome Web Store listing should explain:

- `tabs` permission is used to show and manage the user's current-window tab list.
- `sidePanel` permission is used to display the extension UI in Chrome's side panel.

If later versions add sync, analytics, cloud backup, or host permissions, the privacy policy and permission explanation must be revisited before release.

## Error handling

Expected errors:

- A tab is closed before an action completes.
- A tab moves to another window.
- A favicon URL fails to load.
- A Chrome tab event arrives out of order.
- The side panel is opened in a context where no normal window is available.

Handling:

- Ignore stale tab events safely.
- Remove missing tabs from the store.
- Use fallback favicon visuals.
- Show a compact empty state when there are no tabs or no search results.
- Log development-only warnings, but avoid noisy production console output.

## Testing strategy

Manual verification for MVP:

- Load unpacked extension in Chrome.
- Open side panel through the extension action.
- Verify current-window tabs render.
- Open, close, move, pin, and activate tabs.
- Search by title, domain, and URL.
- Test with 1 tab, 20 tabs, and 100+ tabs.
- Confirm no UI is injected into webpages.
- Confirm no network requests are made by the extension.

Automated or semi-automated checks:

- TypeScript compile.
- Lint or static check if tooling is added.
- Small unit tests for URL/domain normalization and tab filtering if a test runner is added.

## Future extension path

After the MVP is stable:

- v1.1: keyboard shortcuts, settings page, drag-to-reorder.
- v1.2: recent closed tabs and multi-window awareness.
- v1.3: Chrome tab group support.
- v1.4: duplicate tab detection and domain grouping.
- v2: workspaces, session save/restore, optional sync.

Each new feature should preserve the MVP rule: do not add permissions or persistent background work unless the user-facing value clearly justifies it.

## Implementation defaults

- Working product name: `SideTab Lite`.
- Keyboard navigation is deferred to v1.1 except for the browser's default focus behavior and search input usability.
- Use TypeScript with a minimal build step.
- Keep branding plain for the MVP: neutral colors, compact layout, and no custom remote assets.

These defaults can change later, but they should be treated as the baseline for the first implementation plan.
