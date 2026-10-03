import { notFound } from "next/navigation";
import QueueApp from "../../components/QueueApp";
export default async function Page({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const single =
    path.length === 1 &&
    [
      "check-in",
      "track",
      "staff",
      "insights",
      "admin",
      "display",
      "account",
      "tokens",
      "payments",
    ].includes(path[0]);
  const auth =
    path.length === 2 &&
    ["login", "signup"].includes(path[0]) &&
    ["user", "hospital"].includes(path[1]);
  const tracking =
    path.length === 2 && path[0] === "track" && /^[a-f0-9]{48}$/.test(path[1]);
  if (!single && !auth && !tracking) notFound();
  return <QueueApp />;
}
