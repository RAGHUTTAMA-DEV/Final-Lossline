/**
 * Seed 7-day POS / review / inventory / staffing history for
 * Koramangala + Jayanagar + Indiranagar.
 *
 * Usage: npm run seed:portfolio
 *        npm run seed:portfolio:keep-primary
 */
import { pool } from "../src/db/pool.js";
import { seedPortfolio } from "../src/services/seedPortfolio.js";

async function main() {
  const keepPrimary = process.argv.includes("--keep-primary");
  console.log(
    `[seed:portfolio] starting (keepPrimary=${keepPrimary})…`,
  );
  const result = await seedPortfolio({ keepPrimary });
  console.log(
    `[seed:portfolio] wiped ${result.eventsDeleted} events from ${result.wipedStoreIds.join(", ") || "(none)"}`,
  );
  console.log(`[seed:portfolio] inserted ${result.eventsInserted} events`);
  console.log(
    `[seed:portfolio] metrics refreshed: ${result.metricsRefreshed.join(", ")}`,
  );
  if (keepPrimary) {
    console.log(
      "[seed:portfolio] kept primary untouched — use full seed to refresh Koramangala history.",
    );
  } else {
    console.log(
      "[seed:portfolio] primary wiped. Re-run npm run replay:meghana -- G3 if you need a live incident.",
    );
  }
  console.log("[seed:portfolio] done.");
  await pool.end();
}

main().catch(async (err) => {
  console.error("[seed:portfolio] failed:", err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
