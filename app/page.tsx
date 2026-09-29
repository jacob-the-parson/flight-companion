// Root route — the app has no landing page; it opens on the dashboard.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/dashboard');
}
