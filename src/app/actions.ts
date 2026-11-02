"use server";

import { revalidatePath } from "next/cache";
import { appStunt } from "./app-stunt.ts";

export async function markTasksDone(ids: string[]): Promise<void> {
  await appStunt().markDone(...ids);
  revalidatePath("/", "layout");
}
