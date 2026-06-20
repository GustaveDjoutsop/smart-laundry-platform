import { BotForm } from '@/components/bots/bot-form';

export default function NewBotPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Create a New Bot</h2>
        <p className="text-sm text-gray-500">
          Define the identity, credentials and configuration for a new WhatsApp
          bot.
        </p>
      </div>
      <BotForm mode="create" />
    </div>
  );
}
