export default function ReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="-mt-[var(--nav-height)] min-h-screen bg-white">{children}</div>;
}
