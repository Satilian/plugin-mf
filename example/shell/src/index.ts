import { bootstrap } from "./bootstrap";

bootstrap().catch((error: unknown) => console.error("Unable to bootstrap shell", error));
