import { notFound } from "next/navigation";
import QueueApp from "../../components/QueueApp";

export default async function Page({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;

  const singlePage =
    path.length === 1 &&
    ["check-in", "track", "staff", "admin", "display"].includes(path[0]);

  const tracker = path.length === 2 && path[0] === "track";

  if (!singlePage && !tracker) {
    notFound();
  }

  return <QueueApp />;
}