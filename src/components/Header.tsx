'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getDatabase } from '@/lib/client/api';

const links = [
  { href: '/board', label: 'Board' },
  { href: '/book', label: 'Book' },
  { href: '/lab', label: 'Lab' },
];

export function Header() {
  const pathname = usePathname();
  const [database, setDatabase] = useState('camusbooking');

  useEffect(() => {
    setDatabase(getDatabase());
    const onStorage = () => setDatabase(getDatabase());
    window.addEventListener('camus-database', onStorage);
    return () => window.removeEventListener('camus-database', onStorage);
  }, [pathname]);

  return (
    <header className="top">
      <Link href="/" className="brand">
        CamusBooking
      </Link>
      <div className="top-end">
        <nav className="top-nav">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={pathname === link.href ? 'active' : undefined}>
              {link.label}
            </Link>
          ))}
        </nav>
        <Link className="ghost" href="/book">
          Book a seat
        </Link>
        <span className="branch-pill">{database}</span>
      </div>
    </header>
  );
}
