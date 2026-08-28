// No-op touch to trigger a production redeploy (R10's CDN/asset optimization
// work was merged but never promoted past dev) -- see docs/INFRASTRUCTURE.md.
// Follow-up: auto-deploy was enabled here after #192's push, so it was missed.
import Sidebar from '@/components/ui/Sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
