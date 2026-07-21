'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearTokens } from '@/lib/auth';

function NavItem({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + '/');
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-white/10 text-white'
          : 'text-stone-400 hover:text-white hover:bg-white/5'
      }`}
    >
      <span className="w-4 h-4 shrink-0">{icon}</span>
      {label}
    </Link>
  );
}

const IconGrid = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const IconPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);

const IconLogout = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
  </svg>
);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const logout = () => { clearTokens(); router.push('/login'); };

  return (
    <div className="flex min-h-screen bg-stone-50">
      {/* 사이드바 */}
      <aside className="w-56 shrink-0 bg-stone-900 flex flex-col fixed inset-y-0 left-0 z-30">
        {/* 로고 */}
        <div className="px-5 h-16 flex items-center border-b border-white/5">
          <span className="text-white font-bold text-lg tracking-tight">NMeeto</span>
          <span className="ml-2 text-[10px] text-stone-500 font-medium mt-0.5">AI 모의면접</span>
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 px-3 py-5 space-y-1">
          <NavItem href="/dashboard" label="대시보드" icon={<IconGrid />} />
          <NavItem href="/session/new" label="새 면접 시작" icon={<IconPlus />} />
        </nav>

        {/* 하단 사용자 */}
        <div className="px-3 pb-5 border-t border-white/5 pt-4">
          <button
            onClick={logout}
            className="flex items-center gap-2.5 px-3 py-2 w-full text-left text-stone-400 hover:text-white hover:bg-white/5 rounded-lg text-sm transition-colors"
          >
            <span className="w-4 h-4 shrink-0"><IconLogout /></span>
            로그아웃
          </button>
        </div>
      </aside>

      {/* 메인 콘텐츠 */}
      <div className="flex-1 ml-56 flex flex-col min-h-screen">
        {children}
      </div>
    </div>
  );
}
