"use client";

import { AlertOctagon, ArrowLeft, Briefcase } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

export default function UnauthorizedPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-8 text-center shadow-xl"
      >
        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertOctagon className="w-8 h-8 text-red-500" />
        </div>
        
        <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">ACCESS DENIED</h1>
        <p className="text-neutral-400 mb-8">
          You don&apos;t have permission to access this area. If you believe this is a mistake, please contact your administrator.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-800 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-yellow-500 text-black hover:bg-yellow-400 transition-colors font-medium"
          >
            <Briefcase className="w-4 h-4" />
            Go to Home
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
