import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "French Property Sales — DVF+ Explorer",
  description: "Interactive explorer for French property transactions (DVF+ 2021–2025)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
