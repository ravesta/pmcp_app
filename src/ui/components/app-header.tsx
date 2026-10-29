'use client';

import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

/** Satu entri menu utama. */
export interface NavItem {
  readonly label: string;
  readonly href: string;
}

/** Properti header aplikasi. */
interface AppHeaderProps {
  readonly items: ReadonlyArray<NavItem>;
  readonly userName: string;
  readonly roleLabel: string;
  /** Aksi Keluar (Server Action) yang dipasang pada tombol di menu pengguna. */
  readonly logoutAction: () => Promise<void>;
}

/**
 * Header aplikasi: menu utama menurut peran dan menu pengguna (Ganti password, Keluar).
 * Masukan: entri menu, nama dan peran pengguna, aksi keluar. Keluaran: elemen header.
 * Efek samping: menyimpan state buka/tutup menu pengguna; Keluar mengirim Server Action.
 * Rujukan: FR-01-03, FR-01-04, Screen [025], handoff UX/UI §5.4, NFR-05 (keyboard dan fokus).
 */
export function AppHeader({ items, userName, roleLabel, logoutAction }: AppHeaderProps) {
  const pathname = usePathname();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = items.findIndex((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return (
    <Box component="header" sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', px: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      <Typography variant="h2" component="span" sx={{ fontSize: 18 }}>PMCP</Typography>
      <Tabs value={current === -1 ? false : current} aria-label="Menu utama" variant="scrollable" scrollButtons={false} sx={{ flex: 1, minWidth: 0 }}>
        {items.map((item) => (
          <Tab key={item.href} label={item.label} component={Link} href={item.href} aria-current={pathname.startsWith(item.href) ? 'page' : undefined} />
        ))}
      </Tabs>
      <Button
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : 'false'}
        sx={{ borderRadius: 99, border: 1, borderColor: 'divider', textAlign: 'left', gap: 1, my: 1 }}
      >
        <Avatar sx={{ width: 28, height: 28, fontSize: 13 }} aria-hidden>{userName.slice(0, 1).toUpperCase()}</Avatar>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.1 }}>{userName}</Typography>
          <Typography variant="caption" color="text.secondary">{roleLabel}</Typography>
        </Box>
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography sx={{ fontWeight: 600 }}>{userName}</Typography>
          <Typography variant="caption" color="text.secondary">{roleLabel}</Typography>
        </Box>
        <Divider />
        <MenuItem component={Link} href="/ubah-password" onClick={() => setAnchor(null)}>Ganti password</MenuItem>
        <Box component="form" action={logoutAction}>
          <MenuItem component="button" type="submit" sx={{ width: '100%' }}>Keluar</MenuItem>
        </Box>
      </Menu>
    </Box>
  );
}
