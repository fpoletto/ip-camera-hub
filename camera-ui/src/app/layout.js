import "./globals.css";

export const metadata = {
  title: "IP Camera Hub - Sistema de Monitoramento",
  description: "Painel inteligente de monitoramento local para câmeras IP e ONVIF",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
