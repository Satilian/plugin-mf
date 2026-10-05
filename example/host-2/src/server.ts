import type { Express } from "express";
import express from "express";
import cors from "cors";

const app: Express = express();
const port: number = Number(process.env.PORT);

app.use(cors());
app.use(express.static("dist"));

app.listen(port, (): void => {
  console.log(`Example app listening on port ${port}`);
});
