"use server";

import { revalidatePath } from "next/cache";

import { addTodo, removeTodo, toggleTodo } from "@/lib/store";

export async function add(form: FormData): Promise<void> {
  const title = String(form.get("title") ?? "").trim();
  if (title !== "") {
    addTodo(title);
    revalidatePath("/todos");
  }
}

export async function toggle(id: string): Promise<void> {
  toggleTodo(id);
  revalidatePath("/todos");
}

export async function remove(id: string): Promise<void> {
  removeTodo(id);
  revalidatePath("/todos");
}
