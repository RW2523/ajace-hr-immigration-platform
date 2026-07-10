import { redirect } from 'next/navigation';

// Authenticated users go to their workspace; the middleware sends everyone else to /login.
export default function Home() {
  redirect('/dashboard');
}
