// Handoff — how one domain passes a FILE to another. Domains never import each
// other's stores; they meet here. The planner writes a plan file and leaves it;
// Missions picks it up and opens it exactly as it would a file from disk, so
// there is one way in and it is the tested one. Not persisted: a handoff that
// is not collected is gone on reload.
import { create } from 'zustand';

export interface HandoffFile {
  /** The route of the domain it is for. */
  to: string;
  fileName: string;
  text: string;
  /** Where it came from, shown to the user. */
  from: string;
}

interface HandoffState {
  pending: HandoffFile | null;
  send: (file: HandoffFile) => void;
  /** Take the file addressed to a domain, if there is one. */
  take: (to: string) => HandoffFile | null;
}

export const useHandoffStore = create<HandoffState>((set, get) => ({
  pending: null,
  send: (pending) => set({ pending }),
  take: (to) => {
    const file = get().pending;
    if (!file || file.to !== to) return null;
    set({ pending: null });
    return file;
  },
}));
