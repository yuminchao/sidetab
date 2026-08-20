import { createFloatingBallBackground } from "../floating-ball/background-actions";
import { isFloatingBallRequest } from "../floating-ball/messages";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

const floatingBallBackground = createFloatingBallBackground({
  tabs: chrome.tabs,
  tabGroups: chrome.tabGroups,
  bookmarks: chrome.bookmarks,
  history: chrome.history,
  sidePanel: chrome.sidePanel,
  scripting: chrome.scripting,
  storage: chrome.storage.local,
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isFloatingBallRequest(message)) return undefined;
  void floatingBallBackground.handle(message, sender).then(sendResponse);
  return true;
});
