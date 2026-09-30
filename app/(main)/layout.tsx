// (main) layout — every main route renders inside the Shell chrome, with the
// assistant's widget over it. Server component by design; Shell and the widget
// are client islands. The widget is mounted here, beside the Shell, so that
// adding it did not edit the Shell.
import { Shell } from '@/components/shell/Shell';
import { AssistantWidget } from '@/globals/assistant/AssistantWidget';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Shell>{children}</Shell>
      <AssistantWidget />
    </>
  );
}
