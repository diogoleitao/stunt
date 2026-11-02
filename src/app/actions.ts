"use server";

import { revalidatePath } from "next/cache";
import { appStunt } from "./app-stunt.ts";

export async function markTaskDone(id: string): Promise<void> {
  await appStunt().markDone(id);
  revalidatePath("/", "layout");
}
