import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Valoda — Latvian with Birkenbihl",
  description: "Learn Latvian through interlinear decoding",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
