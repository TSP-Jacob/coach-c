"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
      <AlertTriangle size={40} className="text-red-400" />
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-gray-500 max-w-sm">{error.message}</p>
      <button onClick={reset}
        className="bg-brand text-white text-sm px-5 py-2 rounded-lg hover:bg-brand-dark transition-colors">
        Try again
      </button>
    </div>
  );
}
