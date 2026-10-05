import type { Express, Response, Request } from "express";
import express from "express";
import fs from "fs";
import { resolve } from "path";
import { renderToPipeableStream } from "react-dom/server.node";
import { PassThrough } from "stream";
import App from "./App";

const app: Express = express();
const port: number = 3000;

export function isBot(userAgent: string | undefined) {
  return !!userAgent && /bot|crawl|spider|slurp|facebook|telegram/i.test(userAgent);
}

const splitPattern = '<div id="root">';
const html = fs.readFileSync(resolve("dist/index.html"), "utf8");
const [head, tail] = html.split(splitPattern);

app.use(express.static("dist", { index: false }));

app.get("{*splat}", (req: Request, res: Response) => {
  res.statusCode = 200;
  res.setHeader("Content-type", "text/html");

  const write = (chunk: unknown) => {
    res.write(chunk);
  };

  const bot = isBot(req.get("user-agent"));

  res.write(head + splitPattern);

  const stream = renderToPipeableStream(<App pathname={req.path} query={req.query} />, {
    [bot ? "onAllReady" : "onShellReady"]() {
      getBody(stream.pipe(new PassThrough()), write).then(() => {
        res.write(tail);
        res.end();
      });
    },
    onShellError: (error: any) => {
      console.error("❌ [renderStream] \r\n", error);
      res.send(error.message);
    },
    onError: (error: any) => {
      console.error("❌ [renderStream] \r\n", error);
    },
  });
});

app.listen(port, (): void => {
  console.log(`Example app listening on port ${port}`);
});

const getBody = (bodyStream: PassThrough, write: (chunk: unknown) => void) => {
  const chunks: Buffer[] = [];

  return new Promise<string>((resolve) => {
    bodyStream.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      write(chunk);
    });

    bodyStream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
};
