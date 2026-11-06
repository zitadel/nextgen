import Link from "next/link";

export default function Home() {
  return (
    <>
      <h1>Todos for the whole team</h1>
      <p>Keep track of what needs doing, and tick it off when it is done.</p>
      <p>
        <Link href="/todos">Open your todos</Link>
      </p>
    </>
  );
}
