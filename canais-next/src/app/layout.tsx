import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CineDark · Painel do catálogo",
  description: "Gerencie filmes, séries e canais ao vivo do CineDark.",
  icons: { icon: "/cinedark/icon.png" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
