import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
      <p className="text-5xl font-bold text-gray-200">404</p>
      <h2 className="text-lg font-semibold">Page not found</h2>
      <Link href="/" className="text-sm text-brand hover:underline">Back to Dashboard</Link>
    </div>
  );
}
