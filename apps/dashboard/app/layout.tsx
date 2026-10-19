import type { Metadata } from "next";

import { AuthProvider } from "@/lib/auth";

import "./globals.css";

export const metadata: Metadata = {
  title: "MedGuides · Fiches",
  description: "Clinical fiche production workshop",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
