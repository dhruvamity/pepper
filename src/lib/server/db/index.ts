import { config } from "../env";
import type { Repo } from "./types";

const g = globalThis as unknown as { __pepperRepo?: Repo };

/** The active repository (Firestore when credentials exist, otherwise the local JSON store). */
export async function repo(): Promise<Repo> {
  if (g.__pepperRepo) return g.__pepperRepo;
  if (config.db === "firestore") {
    const { FirestoreRepo } = await import("./firestore");
    g.__pepperRepo = new FirestoreRepo();
  } else {
    const { LocalRepo } = await import("./local");
    g.__pepperRepo = new LocalRepo();
  }
  return g.__pepperRepo;
}

export type { Repo } from "./types";
