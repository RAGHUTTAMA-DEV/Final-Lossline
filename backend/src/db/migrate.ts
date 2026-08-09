import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate(): Promise<void> {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = await readFile(schemaPath, "utf8");

  console.log("Applying schema from", schemaPath);
  await pool.query(sql);
  console.log("Migration complete.");
}

migrate()
  .catch((err: unknown) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
