import path from "node:path";

export const moduleResolver = (request: string, remoteNames: string[]) => {
  if (
    request.startsWith(".") ||
    request.startsWith("/") ||
    request.startsWith("data:") ||
    path.isAbsolute(request)
  ) {
    return request;
  }

  const [maybeRemote, ...rest] = request.split("/");
  if (!remoteNames.includes(maybeRemote)) return request;

  const expose = rest.join("/") || "default";

  const code = `
    import { getRemote } from "plugin-mf";
    export default getRemote(${JSON.stringify(maybeRemote)}).lazyComponent(${JSON.stringify(expose)});
  `;

  return `data:text/javascript,${encodeURIComponent(code)}`;
};
