export const resolver = (
  request: string,
  remoteNames: string[],
  env: string,
) => {
  if (
    request.startsWith(".") ||
    request.startsWith("/") ||
    request.startsWith("data:")
  ) {
    return request;
  }

  const [maybeRemote, ...rest] = request.split("/");
  if (!remoteNames.includes(maybeRemote)) return request;

  const expose = rest.join("/") || "default";
  const scope = env === "node" ? "server" : "client";

  const code = `
    import { getRemote} from "plugin-mf/${scope}";
    export default getRemote(${JSON.stringify(maybeRemote)}).lazyComponent(${JSON.stringify(expose)});
  `;

  return `data:text/javascript,${encodeURIComponent(code)}`;
};
