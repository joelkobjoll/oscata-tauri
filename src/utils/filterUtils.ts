export interface Filters {
  search: string;
  releaseType: string;
  resolution: string;
  hdr: string;
  genre: string;
  sort: string;
}

export function normalizeResolution(raw?: string): string {
  const value = raw?.trim().toUpperCase() ?? "";
  if (!value) return "";
  if (value.includes("2160") || value.includes("4K")) return "2160P";
  if (value.includes("1080")) return "1080P";
  if (value.includes("720")) return "720P";
  if (value.includes("480")) return "480P";
  return value;
}

export function normalizeReleaseType(raw?: string): string {
  const value = raw?.trim().toUpperCase() ?? "";
  if (!value) return "";
  if (value.includes("BDREMUX")) return "BDREMUX";
  if (value.includes("BDRIP")) return "BDRIP";
  if (value.includes("BLURAY") || value.includes("BLU-RAY")) return "BLURAY";
  if (value.includes("WEB-DL") || value === "WEBDL" || value.includes("WEB DL"))
    return "WEB-DL";
  if (
    value.includes("WEBRIP") ||
    value.includes("WEB-RIP") ||
    value.includes("WEB RIP")
  )
    return "WEBRIP";
  if (value.includes("HDTV")) return "HDTV";
  if (value.includes("DVDRIP")) return "DVDRIP";
  if (value.includes("CAM")) return "CAM";
  return value;
}

export function normalizeHdr(raw?: string): string {
  const value = raw?.trim().toUpperCase() ?? "";
  if (!value) return "";
  if (value.includes("HDR10+") || value.includes("HDR10PLUS")) return "HDR10+";
  if (
    value.includes("DOVI") ||
    value.includes("DOLBY VISION") ||
    /\bDV\b/.test(value)
  )
    return "DV";
  if (value.includes("HDR10")) return "HDR10";
  if (value.includes("HDR")) return "HDR";
  return value;
}
