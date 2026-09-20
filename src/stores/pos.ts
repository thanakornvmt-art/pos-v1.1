import { create } from "zustand";
import type { Draft } from "@/lib/offline/db";
interface PosState {
  draft: Draft | null;
  setDraft: (draft: Draft) => void;
  billsOpen: boolean;
  setBillsOpen: (open: boolean) => void;
}
export const usePos = create<PosState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  billsOpen: false,
  setBillsOpen: (billsOpen) => set({ billsOpen }),
}));
