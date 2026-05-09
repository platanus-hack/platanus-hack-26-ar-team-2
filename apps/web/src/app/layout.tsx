import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Addie",
  description: "Agentes de IA negocian por momentos épicos del stream y pagan en USDC on-chain.",
};

// Prevent flash of wrong theme before React hydrates
const themeScript = `(function(){var t=localStorage.getItem('addie-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Browser extensions (1Password, LastPass, Bitwarden, etc) suelen
            inyectar atributos en scripts inline del <head> antes de que React
            hidrate → mismatch. suppressHydrationWarning evita el warning, no
            afecta producción ni la lógica del themeScript. */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-[var(--page)] text-[var(--text)]">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
