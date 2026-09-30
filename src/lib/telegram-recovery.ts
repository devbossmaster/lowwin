type TelegramNavigation = {
  initData?: string;
  platform?: string;
  openTelegramLink?: (url: string) => void;
  close?: () => void;
};

// Navigation capability only; this is never used as authentication proof.
export function openBotFromMiniApp(botUrl: string, app?: TelegramNavigation): boolean {
  if (!app || (!app.initData && (!app.platform || app.platform === 'unknown')) || !app.openTelegramLink || !app.close) return false;
  try {
    const url = new URL(botUrl);
    if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.username || url.password || url.port || !/^\/[A-Za-z0-9_]+bot$/i.test(url.pathname)) return false;
    if (url.hash || [...url.searchParams.keys()].some(key => key !== 'start') || url.searchParams.getAll('start').length > 1) return false;
    app.openTelegramLink(botUrl);
  } catch {
    // Leave the ordinary anchor available if the Telegram bridge cannot open it.
    return false;
  }
  // Since Telegram 7.0, opening a Telegram link no longer closes the Mini App.
  // Dispatch both native events in the click gesture; a timer may be suspended.
  try { app.close(); } catch { /* The screen also explains how to close manually. */ }
  return true;
}
