import Link from "next/link";

import { add, remove, toggle } from "@/app/actions";
import { listTodos } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function Todos() {
  return (
    <>
      <h1>Your todos</h1>
      <form action={add}>
        <input name="title" placeholder="What needs doing?" aria-label="New todo" />
        <button type="submit">Add</button>
      </form>
      <ul>
        {listTodos().map((todo) => (
          <li key={todo.id}>
            <form action={toggle.bind(null, todo.id)}>
              <button type="submit" aria-label={`Toggle ${todo.title}`}>
                {todo.done ? "☑" : "☐"}
              </button>
            </form>
            <Link href={`/todos/${todo.id}`} className={todo.done ? "done" : undefined}>
              {todo.title}
            </Link>
            <form action={remove.bind(null, todo.id)}>
              <button type="submit" aria-label={`Delete ${todo.title}`}>
                ✕
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
