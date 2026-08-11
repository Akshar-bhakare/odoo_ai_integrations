'use client';

import { FormEvent, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

const LOGO = '/WhatsApp Image 2026-08-01 at 1.15.58 PM.jpeg';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: form.get('login'), password: form.get('password') }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? 'Login failed');
      setPending(false);
      return;
    }
    const next = new URLSearchParams(window.location.search).get('next');
    router.replace(next?.startsWith('/') ? next : '/');
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
      <form onSubmit={submit} className="w-full space-y-5 rounded-xl border border-border-custom bg-card-bg p-8">
        <Image src={LOGO} alt="Sunlectric" width={120} height={40} className="object-contain" priority />
        <div><h1 className="text-2xl font-semibold">Sign in</h1><p className="mt-1 text-sm text-muted-custom">Use your Odoo login and password.</p></div>
        <label className="block text-sm">Odoo login<input name="login" autoComplete="username" required className="mt-1 w-full rounded-md border border-border-custom bg-transparent px-3 py-2" /></label>
        <label className="block text-sm">Password<input name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded-md border border-border-custom bg-transparent px-3 py-2" /></label>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={pending} className="w-full rounded-md bg-foreground px-4 py-2 text-background disabled:opacity-50">{pending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
