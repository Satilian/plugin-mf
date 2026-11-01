export function validateAssetPath(value: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error(`[plugin-mf] Invalid asset path: ${value}`);
  }
  if (!value || /[\\\x00-\x1f\x7f:?#]/.test(decoded) || decoded.split("/").length !== value.split("/").length ||
    decoded.split("/").some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part) || part.toLowerCase() === ".pins")) {
    throw new Error(`[plugin-mf] Invalid asset path: ${value}`);
  }
}
