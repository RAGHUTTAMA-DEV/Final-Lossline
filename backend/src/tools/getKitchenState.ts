import { z } from "zod";
import { env } from "../config/env.js";
import { getEventsSince } from "../services/events.js";
import { deriveKitchenState } from "../services/kitchenState.js";

const inputSchema = z.object({
  storeId: z.string().min(1),
  sinceMinutes: z.number().min(5).max(180).optional().default(60),
});

export async function getKitchenState(raw: unknown) {
  const input = inputSchema.parse(raw);
  const storeId = input.storeId || env.STORE_ID;
  const since = new Date(Date.now() - input.sinceMinutes * 60_000);
  const events = await getEventsSince(storeId, since);
  const kitchen = deriveKitchenState(events);

  return {
    storeId,
    brand: "Meghana Biryani",
    windowMinutes: input.sinceMinutes,
    kitchen,
    guidance: {
      inventory_shortage: "Prefer emergency_stock_transfer or eighty_six_sku — not pause for 'kitchen shortage'.",
      staffing_shortfall: "Prefer call_in_prep_staff — stock is usually fine.",
      delivery_oversell: "Prefer pause_delivery — oversell ≠ kitchen shortage.",
      capacity_pressure: "Stock OK + demand spike → throttle_new_orders / call staff.",
      inventory_shortage_recovering:
        "Replenishment already landed — extend ETA briefly, avoid permanent 86 if onHand recovered.",
    },
  };
}
