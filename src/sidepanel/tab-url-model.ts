/**
 * 返回 HTTP/HTTPS URL 的规范化完整主机名，其他 URL 返回 undefined。
 */
export function getHttpHostname(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.hostname
      : undefined;
  } catch {
    return undefined;
  }
}
