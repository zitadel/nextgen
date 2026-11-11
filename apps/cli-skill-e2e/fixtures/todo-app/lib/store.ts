export interface Todo {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
}

/** The todos live in memory: this app is a stand-in for one a team already runs. */
const todos = new Map<string, Todo>(
  [
    { id: "1", title: "Write the quarterly report", done: false },
    { id: "2", title: "Book the team offsite", done: true },
    { id: "3", title: "Review the pull requests", done: false },
  ].map((todo) => [todo.id, todo]),
);

export const listTodos = (): ReadonlyArray<Todo> => [...todos.values()];

export const getTodo = (id: string): Todo | undefined => todos.get(id);

export function addTodo(title: string): void {
  const id = String(Date.now());
  todos.set(id, { id, title, done: false });
}

export function toggleTodo(id: string): void {
  const todo = todos.get(id);
  if (todo !== undefined) {
    todos.set(id, { ...todo, done: !todo.done });
  }
}

export function removeTodo(id: string): void {
  todos.delete(id);
}
