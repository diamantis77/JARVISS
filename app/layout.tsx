import type { Metadata } from "next";
import "./globals.css";
import "./command-center.css";
import "./jarvis-core.css";
import "./command-center-hud.css";

export const metadata: Metadata = { title: "JARVIS · Επιχειρηματικό OS", description: "Προσωπικό επιχειρηματικό λειτουργικό σύστημα AI" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="el-GR"><body>{children}</body></html>; }
