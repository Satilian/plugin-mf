import type { Express, Response, Request } from "express";
import express from "express";
import fs from "node:fs";
import { resolve } from "node:path";
import { renderToPipeableStream } from "react-dom/server.node";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import App from "./App";
import { configureObservability, runWithMFRequest, serializeMFReleases } from "plugin-mf/server";

if (process.env.MF_TRACE === "1") configureObservability((event) => console.log(JSON.stringify({ source: "mf", ...event })));

const app: Express = express();
const port = 3000;
const SSR_DEADLINE_MS = 8_000;

export function isBot(userAgent: string | undefined): boolean {
  return !!userAgent && /bot|crawl|spider|slurp|facebook|telegram/i.test(userAgent);
}

const splitPattern = '<div id="root">';
const html = fs.readFileSync(resolve("dist/index.html"), "utf8");
const [head, tail] = html.split(splitPattern);
app.use(express.static("dist", { index: false }));

app.get("{*splat}", (req: Request, res: Response) => {
  const controller = new AbortController();
  runWithMFRequest(() => {
    const body = new PassThrough();
    let started = false;
    let deadlineExceeded = false;
    const cleanup = () => {
      clearTimeout(deadline);
      res.off("close", disconnect);
    };
    const disconnect = () => {
      if (res.writableFinished) return;
      controller.abort(new Error("SSR client disconnected"));
      stream.abort(controller.signal.reason);
      body.destroy();
      cleanup();
    };
    const start = () => {
      if (started || res.destroyed || res.writableEnded) return;
      started = true;
      res.statusCode = deadlineExceeded ? 503 : 200;
      res.setHeader("Content-type", "text/html; charset=utf-8");
      res.write(head + splitPattern);
      body.pipe(res, { end: false });
      stream.pipe(body);
    };
    body.on("end", () => {
      cleanup();
      if (!res.destroyed) res.end(tail.replace("</body>", serializeMFReleases() + "</body>"));
    });
    body.on("error", (error: Error) => {
      console.error("[SSR stream]", error);
      cleanup();
      controller.abort(error);
      stream.abort(error);
      res.destroy();
    });
    const deadline = setTimeout(() => {
      deadlineExceeded = true;
      controller.abort(new Error("SSR deadline exceeded"));
      stream.abort(controller.signal.reason);
      start();
    }, SSR_DEADLINE_MS);
    const stream = renderToPipeableStream(<App pathname={req.path} query={req.query} />, {
      [isBot(req.get("user-agent")) ? "onAllReady" : "onShellReady"]() {
        if (!deadlineExceeded) start();
      },
      onShellError(error: unknown) {
        console.error("[SSR shell]", error);
        cleanup();
        controller.abort(error);
        res.status(503).send("Страница временно недоступна");
      },
      onError(error: unknown) {
        console.error("[SSR remote]", error);
      },
    });
    res.once("close", disconnect);
  }, { signal: controller.signal, requestId: req.get("x-request-id") ?? randomUUID() });
});

app.listen(port, () => console.log("Example app listening on port " + port));
