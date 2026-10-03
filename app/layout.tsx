import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "MediQueue",
  description: "Your care. Without the queue.",
  referrer: "no-referrer",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
