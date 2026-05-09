export default function OverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ background: "transparent", margin: 0, overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
