import { z } from "zod";

// Live availability is separate from immutable price/BOM snapshots.
export const availabilitySchema = z.array(
  z.object({ id: z.string(), isActive: z.boolean(), soldOut: z.boolean() }),
);
export type Availability = z.infer<typeof availabilitySchema>;

export function menuIsOpen(id: string, availability?: Availability) {
  return availability?.find((menu) => menu.id === id)?.isActive !== false;
}

export function menuCanBeAdded(id: string, availability?: Availability) {
  const menu = availability?.find((menu) => menu.id === id);
  // Offline devices use their last known status and signed catalog.
  return menu?.isActive !== false && !menu?.soldOut;
}
