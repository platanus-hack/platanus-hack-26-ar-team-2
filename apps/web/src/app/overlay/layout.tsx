export default function OverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "transparent", margin: 0, overflow: "hidden" }}>
      {children}
    </div>
  );
}
