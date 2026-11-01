import "./globals.css";

export const metadata = { title: "The Enemy Within" };

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
