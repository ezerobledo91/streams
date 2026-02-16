const NAMES_KEY = "streams_live_tv_custom_names";

let cachedNames: Record<string, string> | null = null;

export function getLiveTvCustomNames(): Record<string, string> {
  if (cachedNames) return cachedNames;
  try {
    const raw = localStorage.getItem(NAMES_KEY);
    cachedNames = raw ? JSON.parse(raw) : {};
  } catch {
    cachedNames = {};
  }
  return cachedNames!;
}

export function setLiveTvChannelName(channelId: string, name: string) {
  const names = getLiveTvCustomNames();
  if (!name.trim()) {
    delete names[channelId];
  } else {
    names[channelId] = name.trim();
  }
  localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  cachedNames = { ...names };
}

export function getChannelDisplayName(channel: { id: string; name: string }): string {
  const names = getLiveTvCustomNames();
  return names[channel.id] || channel.name;
}
