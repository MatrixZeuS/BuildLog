export function parseApiResponseBody<T>(
  url: string,
  status: number,
  ok: boolean,
  contentType: string,
  rawText: string
): T {
  let parsed: (T & { error?: string }) | null = null;
  const trimmed = rawText.trim();

  if (trimmed.length > 0) {
    try {
      parsed = JSON.parse(trimmed) as T & { error?: string };
    } catch {
      parsed = null;
    }
  }

  if (!ok) {
    if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string' && parsed.error) {
      throw new Error(parsed.error);
    }
    throw new Error(
      status >= 500
        ? `BuildLog's server ran into a problem (error ${status}). Please try again in a minute.`
        : `Something went wrong (error ${status}). Please try again.`
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    const looksLikeHtml =
      contentType.toLowerCase().includes('text/html') ||
      trimmed.startsWith('<!') ||
      trimmed.toLowerCase().startsWith('<html');

    if (looksLikeHtml) {
      throw new Error(
        `Server returned HTML instead of JSON from ${url} (HTTP ${status}). BuildLog's server isn't responding as expected. Please try again in a minute.`
      );
    }

    throw new Error(
      `BuildLog's server sent back an invalid or empty response (error ${status}). Please try again.`
    );
  }

  return parsed;
}
