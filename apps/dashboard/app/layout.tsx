import type { Metadata } from "next";

import { AuthProvider } from "@/lib/auth";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Avero", template: "%s · Avero" },
  description: "Clinical protocols for Algerian GPs, sourced line by line from official guidelines: the editorial workshop.",
  applicationName: "Avero",
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
