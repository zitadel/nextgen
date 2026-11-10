import Link from "next/link";
import { notFound } from "next/navigation";

import { getTodo } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function TodoPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const todo = getTodo((await params).id);
  if (todo === undefined) {
    notFound();
  }
  return (
    <>
      <h1>{todo.title}</h1>
      <p>{todo.done ? "Done" : "Still to do"}</p>
      <p>
        <Link href="/todos">Back to your todos</Link>
      </p>
    </>
  );
}
