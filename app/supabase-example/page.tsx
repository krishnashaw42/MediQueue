import { cookies } from "next/headers";
import { createClient } from "../../utils/supabase/server";

export default async function Page() {
  const supabase = createClient(await cookies());
  const { data: todos, error } = await supabase.from("todos").select("id, name");

  if (error) {
    return <p>Unable to load todos. Check that the database is active and the todos table has a read policy for this account.</p>;
  }

  return (
    <ul>
      {todos?.map(todo => <li key={todo.id}>{todo.name}</li>)}
    </ul>
  );
}
