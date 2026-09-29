// (main) layout — every main route renders inside the Shell chrome.
// Server component by design; Shell is a client island.
import { Shell } from '@/components/shell/Shell';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
