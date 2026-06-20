import Link from 'next/link';
import { BookOpen, Github, ExternalLink } from 'lucide-react';

const guides = [
  {
    title: 'Create a Bot',
    description:
      'Define a bot ID, bot type, WhatsApp Phone Number ID and credentials to register a new bot in the system.',
    href: '/dashboard/bots/new',
    internal: true,
  },
  {
    title: 'Bot Types',
    description:
      'Supported types: laundry, thomas_network, pharmacy. Each type activates a different conversation flow plugin.',
    href: 'https://github.com/GustaveDjoutsop/spring-bot-manager',
    internal: false,
  },
  {
    title: 'Credentials',
    description:
      'Verify Token, Access Token and App Secret are required for the WhatsApp Cloud API. They are stored encrypted.',
    href: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    internal: false,
  },
  {
    title: 'Registry Refresh',
    description:
      'After creating or updating a bot, click "Refresh Registry" to publish a reload event to the backend.',
    href: '/dashboard/settings',
    internal: true,
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Help & Guides</h2>
        <p className="text-sm text-gray-500">
          Quick references for managing your WhatsApp bots.
        </p>
      </div>

      <div className="grid gap-4">
        {guides.map((g) => (
          <div
            key={g.title}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50">
                  <BookOpen className="h-4 w-4 text-brand-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {g.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">{g.description}</p>
                </div>
              </div>
              {g.internal ? (
                <Link
                  href={g.href}
                  className="flex-shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  Go →
                </Link>
              ) : (
                <a
                  href={g.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  Docs <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* GitHub link */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <Github className="h-5 w-5 text-gray-700" />
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Backend Repository
            </p>
            <a
              href="https://github.com/GustaveDjoutsop/spring-bot-manager"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand-600 hover:text-brand-700"
            >
              github.com/GustaveDjoutsop/spring-bot-manager
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
