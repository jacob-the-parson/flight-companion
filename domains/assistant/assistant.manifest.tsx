// ASSISTANT — a meta-domain, like the dashboard: it belongs to no part of the
// flying day and reads every domain's store, changing none. A chat is its main
// screen. Who answers is an adapter (lib/assistant/adapters.ts).
'use client';
import { Eye, MessageCircle, Paperclip, UserRound } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';
import {
  AssistantAssistantPage,
  AssistantConversationsPanel,
  AssistantDeleteAction,
  AssistantFilesPage,
  AssistantNewAction,
  AssistantSaveAction,
  AssistantSeesPage,
  AssistantSettings,
  AssistantStatusAction,
} from './AssistantChrome';

export const assistant: AppDefinition = {
  id: 'assistant',
  route: 'assistant',
  name: 'Assistant',
  description: 'Ask about the mission, parameters and log that are open. Learn what MCP is and set it up.',
  icon: MessageCircle,
  theme: {
    colorClass: 'text-orange-600 dark:text-orange-400',
    bgClass: 'bg-orange-50 dark:bg-orange-900/40',
    hoverBorder: 'hover:border-orange-300 dark:hover:border-orange-500',
  },
  navigation: { showInSidebar: true, showInDashboard: true, showInSettings: true },
  drawerLeftBottom: AssistantConversationsPanel,
  drawerRight: {
    title: 'Assistant',
    icon: MessageCircle,
    pages: [
      { id: 'who', title: 'Who', icon: UserRound, content: AssistantAssistantPage },
      { id: 'sees', title: 'Sees', icon: Eye, content: AssistantSeesPage },
      { id: 'files', title: 'Files', icon: Paperclip, content: AssistantFilesPage },
    ],
  },
  // footer shape: [status][new][CENTER reserved][Delete][Save]
  shellFooter: [AssistantStatusAction, AssistantNewAction, null, AssistantDeleteAction, AssistantSaveAction],
  settingsBody: AssistantSettings,
};
