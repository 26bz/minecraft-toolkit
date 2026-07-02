import { fetchServerStatus } from "./status.js";

const DEFAULT_INTERVAL_MS = 30_000;

export function watchServerStatus(address, options = {}) {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    immediate = true,
    onUpdate,
    onChange,
    onError,
    ...statusOptions
  } = options;

  let stopped = false;
  let timer = null;
  let previous = null;

  async function poll() {
    if (stopped) {
      return;
    }

    try {
      const status = await fetchServerStatus(address, statusOptions);
      onUpdate?.(status);
      if (hasChanged(previous, status)) {
        onChange?.(status, previous);
      }
      previous = status;
    } catch (error) {
      onError?.(error);
    } finally {
      if (!stopped) {
        timer = setTimeout(poll, intervalMs);
      }
    }
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  timer = setTimeout(poll, immediate ? 0 : intervalMs);

  return { stop };
}

function hasChanged(previous, next) {
  if (!previous) {
    return true;
  }
  if (previous.online !== next.online) {
    return true;
  }
  if ((previous.players?.online ?? null) !== (next.players?.online ?? null)) {
    return true;
  }
  if ((previous.players?.max ?? null) !== (next.players?.max ?? null)) {
    return true;
  }
  if ((previous.motd ?? null) !== (next.motd ?? null)) {
    return true;
  }
  return false;
}
