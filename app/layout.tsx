import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Room Splitter",
  description: "Split shared room expenses between roommates."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
