'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import { useActionState, type ReactNode } from 'react';
import { initialActionState, type ActionState } from '../action-state';
import { useOnSuccess } from '../hooks/use-on-success';
import { useRetainedSubmit } from '../hooks/use-retained-submit';
import { ActionAlert } from './action-alert';

/** Bahan yang diberikan formulir kepada isinya. */
export interface ActionFormContext {
  /** Galat per isian dari server (nama isian ke pesan). */
  readonly fieldErrors: Readonly<Record<string, string>>;
  /** True selama aksi sedang dikirim. */
  readonly pending: boolean;
  /** Data tambahan hasil aksi (mis. daftar project terdampak), bila ada. */
  readonly data: unknown;
}

/** Properti formulir yang terhubung ke Server Action. */
export interface ActionFormProps {
  /** Server Action yang menerima FormData dan mengembalikan `ActionState`. */
  readonly action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  readonly submitLabel: string;
  /** Nilai tersembunyi yang selalu dikirim (mis. id, versi baris). */
  readonly hidden?: Readonly<Record<string, string | number>>;
  readonly submitColor?: 'primary' | 'error';
  /** Dipanggil sekali setiap hasil berhasil baru. */
  readonly onSuccess?: (state: ActionState) => void;
  /** Menampilkan pesan sukses di dalam formulir (dimatikan bila formulir langsung ditutup). */
  readonly showSuccess?: boolean;
  /** Tombol tambahan di sebelah kiri Simpan (mis. Batal). */
  readonly secondary?: ReactNode;
  /** Menaruh tombol Simpan sebelum tombol tambahan dan merapatkan keduanya ke kiri (gaya formulir halaman pada mockup). */
  readonly submitFirst?: boolean;
  /** `dialog` memakai gaya isi dan aksi dialog MUI; `inline` memakai kotak biasa. */
  readonly layout?: 'dialog' | 'inline';
  readonly children: (context: ActionFormContext) => ReactNode;
}

/**
 * Formulir serba guna yang terhubung ke Server Action: isian, pesan hasil, dan tombol Simpan. Isian tidak
 * dikosongkan saat galat. Dipakai langsung oleh dialog (`ActionDialog`) dan oleh dialog bertab.
 * Masukan: aksi, label tombol, isian tersembunyi, gaya, dan fungsi yang menggambar isi. Keluaran: elemen formulir.
 * Efek samping: mengirim Server Action saat Simpan; memanggil `onSuccess` setelah hasil berhasil.
 * Rujukan: handoff UX/UI §7 (galat per isian tanpa kehilangan isian), §6 (keadaan berhasil dan galat).
 */
export function ActionForm({
  action,
  submitLabel,
  hidden = {},
  submitColor = 'primary',
  onSuccess,
  showSuccess = true,
  secondary,
  layout = 'inline',
  submitFirst = false,
  children,
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const onSubmit = useRetainedSubmit(formAction);
  useOnSuccess(state, (result) => onSuccess?.(result));

  const body = (
    <>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children({ fieldErrors: state.ok ? {} : (state.fields ?? {}), pending, data: state.data })}
      <ActionAlert state={state} showSuccess={showSuccess} />
    </>
  );
  const submit = <Button type="submit" variant="contained" color={submitColor} disabled={pending}>{submitLabel}</Button>;
  const buttons = submitFirst ? <>{submit}{secondary}</> : <>{secondary}{submit}</>;
  return (
    <Box component="form" onSubmit={onSubmit} noValidate>
      {layout === 'dialog' ? (
        <>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>{body}</DialogContent>
          <DialogActions>{buttons}</DialogActions>
        </>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {body}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: submitFirst ? 'flex-start' : 'flex-end' }}>{buttons}</Box>
        </Box>
      )}
    </Box>
  );
}
