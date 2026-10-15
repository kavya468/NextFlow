export function transloaditUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(url.hostname === "api2.transloadit.com" || /^api2-[a-z0-9-]+\.transloadit\.com$/.test(url.hostname))) {
    throw new Error("Unexpected upload service URL");
  }
  return url.href;
}
