export function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4000) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return;
    return url.href;
  } catch {
    return;
  }
}
export function sourceOf(
  value: string,
): "INSTAGRAM" | "NAVER" | "BAEMIN" | "WEB" {
  const host = new URL(value).hostname.toLowerCase();
  const belongs = (domain: string) =>
    host === domain || host.endsWith("." + domain);
  return belongs("instagram.com")
    ? "INSTAGRAM"
    : belongs("naver.com") || host === "naver.me"
      ? "NAVER"
      : belongs("baemin.com") ||
          host === "baemin.me" ||
          host === "baemin.app.link"
        ? "BAEMIN"
        : "WEB";
}
export function sharedUrl(text: string): string {
  if (text.length > 16000)
    throw new Error("공유 텍스트가 너무 깁니다. 링크만 다시 보내 주세요.");
  const candidates = text.match(/https:\/\/[^\s<>"']+/g) || [];
  for (const candidate of candidates) {
    const clean = candidate.replace(/[),.\]}>。，]+$/g, "");
    const safe = httpsUrl(clean);
    if (!safe) continue;
    const url = new URL(safe);
    url.hash = "";
    if (sourceOf(safe) === "INSTAGRAM") {
      const post = /^\/(?:reels?|p|tv)\/[\w-]+\/?$/.test(url.pathname);
      const share = /^\/share\/(?:(?:reel|p)\/)?[\w-]+\/?$/.test(url.pathname);
      if (!post && !share) continue;
      url.hostname = "www.instagram.com";
      url.search = "";
      url.pathname = url.pathname.replace(/\/?$/, "/");
    } else {
      for (const key of [...url.searchParams.keys()])
        if (/^(utm_|igsh|fbclid|gclid)/i.test(key))
          url.searchParams.delete(key);
      url.searchParams.sort();
    }
    return url.href;
  }
  throw new Error("릴스 또는 음식점의 https 링크를 넣어 주세요.");
}
