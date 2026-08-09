import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(root, "dist", "db"), { recursive: true });
copyFileSync(
  path.join(root, "src", "db", "schema.sql"),
  path.join(root, "dist", "db", "schema.sql"),
);
console.log("Copied schema.sql → dist/db/");
