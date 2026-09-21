export function AdminShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full min-w-0 max-w-[1500px] p-3 sm:p-5">
      <h1 className="mb-4 break-words text-2xl font-bold sm:mb-6 sm:text-3xl">
        {title}
      </h1>
      {children}
    </main>
  );
}
