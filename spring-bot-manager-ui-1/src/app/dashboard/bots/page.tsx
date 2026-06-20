import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import { BotList } from '@/components/bots/bot-list';

export default function BotsPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">All Bots</h2>
          <p className="text-sm text-gray-500">
            Manage every WhatsApp bot registered in the system.
          </p>
        </div>
        <Link
          href="/dashboard/bots/new"
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
        >
          <PlusCircle className="h-4 w-4" />
          New Bot
        </Link>
      </div>

      <BotList />
    </div>
  );
}
