'use client';

import Button, { type ButtonProps } from '@mui/material/Button';
import Chip, { type ChipProps } from '@mui/material/Chip';
import Link from 'next/link';

/** Properti tombol bertautan: semua properti tombol MUI ditambah alamat tujuan. */
type LinkButtonProps = Omit<ButtonProps<typeof Link>, 'component'> & { readonly href: string };

/** Gaya tombol teks sebagai tautan: warna aksen, bergaris bawah, tidak tebal (kelas `.lnk` mockup). */
const TEXT_LINK_STYLE = { minWidth: 0, px: 0.5, fontWeight: 400, textDecoration: 'underline', '&:hover': { textDecoration: 'underline', bgcolor: 'transparent' } } as const;

/** Properti chip bertautan: semua properti chip MUI ditambah alamat tujuan. */
type LinkChipProps = Omit<ChipProps<typeof Link>, 'component'> & { readonly href: string };

/**
 * Tombol MUI yang menavigasi lewat `next/link` (navigasi sisi klien, tahan tombol kembali). Dibuat sebagai komponen
 * klien karena Server Component tidak boleh meneruskan fungsi (`Link`) ke komponen klien MUI.
 * Varian teks (tanpa `variant`) tampil sebagai tautan biasa seperti mockup.
 * Masukan: properti tombol MUI dan alamat tujuan. Keluaran: tombol berupa tautan.
 * Efek samping: tidak ada selain navigasi saat diklik.
 * Rujukan: Technical Design §7.1 (halaman dirender server), handoff UX/UI §4 (Button), mockup v0.2 (kelas lnk).
 */
export function LinkButton({ sx, ...props }: LinkButtonProps) {
  const asTextLink = props.variant === undefined || props.variant === 'text';
  return <Button {...props} component={Link} sx={asTextLink ? { ...TEXT_LINK_STYLE, ...sx } as ButtonProps['sx'] : sx} />;
}

/**
 * Chip MUI yang menavigasi lewat `next/link`; alasan pembuatannya sama dengan `LinkButton`.
 * Masukan: properti chip MUI dan alamat tujuan. Keluaran: chip berupa tautan.
 * Efek samping: tidak ada selain navigasi saat diklik.
 * Rujukan: Technical Design §7.1, handoff UX/UI §4 (Chip).
 */
export function LinkChip(props: LinkChipProps) {
  return <Chip {...props} component={Link} clickable />;
}
