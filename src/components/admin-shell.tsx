export function AdminShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[1500px] p-5">
      <h1 className="mb-6 text-3xl font-bold">{title}</h1>
      {children}
    </main>
  );
}
