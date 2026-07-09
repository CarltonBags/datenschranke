import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Aurora } from "../components/Aurora";

export const metadata: Metadata = {
  title: "Company Chat — GDPR AI Gateway",
  description: "Chat with LLMs without exposing personal data to providers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>
        <Aurora />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
