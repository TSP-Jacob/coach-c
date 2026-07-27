import type { Metadata } from "next";
import { Playfair_Display, Inter } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import { AuthProvider } from "@/lib/auth";
import SWRProvider from "@/lib/swr";
import AppShell from "@/components/AppShell";

const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair" });
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Coach-C",
  description: "AI Sales Coach — by Chardin Systems",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${playfair.variable} flex h-screen overflow-hidden`}>
        <ToastProvider>
          <AuthProvider>
            <SWRProvider>
              <AppShell>
                {children}
              </AppShell>
            </SWRProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
