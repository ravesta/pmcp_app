'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Select from '@mui/material/Select';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useActionState, useEffect, useState } from 'react';
import { Card } from '@/ui/components/card';
import { ToneChip } from '@/ui/components/tone-chip';
import { useRetainedSubmit } from '@/ui/hooks/use-retained-submit';
import { initialActionState, type ActionState } from '../../_lib/action-state';
import { picAction } from './actions';

/** Satu PIC yang dikirim dari server. */
export interface PicView {
  readonly id: number;
  readonly name: string;
  readonly stage: 'BA' | 'DEV' | 'QA';
  readonly isActive: boolean;
  readonly username: string | null;
}

/** Password sementara yang sedang ditampilkan (tampil sekali). */
interface TemporaryShown {
  readonly name: string;
  readonly username: string;
  readonly password: string;
  readonly created: boolean;
}

const STAGE_LABEL: Record<'BA' | 'DEV' | 'QA', string> = { BA: 'Business Analyst', DEV: 'Development', QA: 'Quality Assurance' };

/**
 * Daftar Master PIC dengan aksi Tambah PIC, Ubah nama, Reset password, dan Nonaktifkan/Aktifkan.
 * Masukan: daftar PIC. Keluaran: kartu dengan tabel dan dialog.
 * Efek samping: menyimpan dialog yang terbuka dan password sementara yang sedang ditampilkan di state komponen
 * (hilang saat dialog ditutup; tidak disimpan di tempat lain).
 * Rujukan: FR-08-01, FR-01-05, Screen [008], handoff UX/UI §5.3.
 */
export function PicTable({ pics }: { readonly pics: ReadonlyArray<PicView> }) {
  const [dialog, setDialog] = useState<{ kind: 'add' } | { kind: 'rename' | 'reset' | 'toggle'; pic: PicView } | null>(null);
  const [temporary, setTemporary] = useState<TemporaryShown | null>(null);
  return (
    <Card>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <div>
          <Typography variant="h2">Master PIC</Typography>
          <Typography variant="body2" color="text.secondary">Manager mengelola daftar PIC dan akun. PIC Development dicatat sebagai nama saja (tanpa login).</Typography>
        </div>
        <Button variant="contained" onClick={() => setDialog({ kind: 'add' })}>+ Tambah PIC</Button>
      </Box>
      <TableContainer>
        <Table size="small" sx={{ minWidth: 640 }}>
          <TableHead>
            <TableRow><TableCell>Nama</TableCell><TableCell>Tahapan</TableCell><TableCell>Login</TableCell><TableCell>Username</TableCell><TableCell>Status</TableCell><TableCell>Aksi</TableCell></TableRow>
          </TableHead>
          <TableBody>
            {pics.map((pic) => (
              <TableRow key={pic.id} hover>
                <TableCell>{pic.name}</TableCell>
                <TableCell>{STAGE_LABEL[pic.stage]}</TableCell>
                <TableCell>{pic.username ? <ToneChip text="Ya" tone="ok" /> : <ToneChip text="Tidak (dicatat)" tone="neutral" />}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace' }}>{pic.username ?? '-'}</TableCell>
                <TableCell><ToneChip text={pic.isActive ? 'Aktif' : 'Nonaktif'} tone={pic.isActive ? 'ok' : 'neutral'} /></TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button size="small" variant="outlined" onClick={() => setDialog({ kind: 'rename', pic })}>Ubah nama</Button>
                    {pic.username && pic.isActive ? <Button size="small" variant="outlined" onClick={() => setDialog({ kind: 'reset', pic })}>Reset password</Button> : null}
                    <Button size="small" variant="outlined" onClick={() => setDialog({ kind: 'toggle', pic })}>{pic.isActive ? 'Nonaktifkan' : 'Aktifkan'}</Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary">Tahapan dan username tidak dapat diubah setelah PIC dibuat. PIC tidak dihapus, hanya dinonaktifkan.</Typography>

      {dialog?.kind === 'add' ? <AddPicDialog onClose={() => setDialog(null)} onTemporary={(shown) => { setDialog(null); setTemporary(shown); }} /> : null}
      {dialog?.kind === 'rename' ? <RenamePicDialog pic={dialog.pic} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'reset' ? <ResetPicDialog pic={dialog.pic} onClose={() => setDialog(null)} onTemporary={(shown) => { setDialog(null); setTemporary(shown); }} /> : null}
      {dialog?.kind === 'toggle' ? <TogglePicDialog pic={dialog.pic} onClose={() => setDialog(null)} /> : null}
      {temporary ? <TemporaryPasswordDialog shown={temporary} onDone={() => setTemporary(null)} /> : null}
    </Card>
  );
}

/**
 * Menjalankan callback sekali setiap ada hasil berhasil baru dari sebuah aksi.
 * Masukan: state aksi dan callback. Keluaran: tidak ada.
 * Efek samping: memanggil callback saat `state.ok` berubah menjadi hasil baru.
 * Rujukan: FR-08-01 (menutup dialog setelah berhasil).
 */
function useOnSuccess(state: ActionState, callback: (state: ActionState) => void): void {
  useEffect(() => {
    if (state.ok) callback(state);
    // callback sengaja tidak menjadi dependensi: hanya hasil baru (stamp) yang memicu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stamp]);
}

/**
 * Dialog Tambah PIC. PIC Development otomatis tanpa akun login.
 * Masukan: callback tutup dan callback saat password sementara dihasilkan. Keluaran: elemen dialog.
 * Efek samping: mengirim `picAction` (intent create).
 * Rujukan: FR-08-01 butir 2 dan 3, EC-08-01.02, Screen [008].
 */
function AddPicDialog({ onClose, onTemporary }: { onClose: () => void; onTemporary: (shown: TemporaryShown) => void }) {
  const [state, formAction, pending] = useActionState(picAction, initialActionState);
  const [stage, setStage] = useState('');
  const onSubmit = useRetainedSubmit(formAction);
  const [login, setLogin] = useState('ya');
  const isDev = stage === 'DEV';
  const fields = state.fields ?? {};
  useOnSuccess(state, (result) => {
    const data = result.data as { username: string | null; temporaryPassword: string | null; name: string } | undefined;
    if (data?.temporaryPassword && data.username) onTemporary({ name: data.name, username: data.username, password: data.temporaryPassword, created: true });
    else onClose();
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="judul-tambah-pic">
      <Box component="form" onSubmit={onSubmit} noValidate>
        <DialogTitle id="judul-tambah-pic">Tambah PIC</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <input type="hidden" name="intent" value="create" />
          <TextField name="name" label="Nama" required error={Boolean(fields.name)} helperText={fields.name} autoFocus slotProps={{ htmlInput: { maxLength: 120 } }} />
          <FormControl fullWidth size="small" error={Boolean(fields.stage)}>
            <InputLabel id="label-tahapan">Tahapan</InputLabel>
            <Select labelId="label-tahapan" name="stage" label="Tahapan" value={stage} onChange={(event) => { setStage(event.target.value); if (event.target.value === 'DEV') setLogin('tidak'); }}>
              <MenuItem value="BA">Business Analyst</MenuItem>
              <MenuItem value="DEV">Development</MenuItem>
              <MenuItem value="QA">Quality Assurance</MenuItem>
            </Select>
            <FormHelperText>{fields.stage ?? 'Tidak dapat diubah setelah disimpan.'}</FormHelperText>
          </FormControl>
          <FormControl>
            <FormLabel id="label-akun">Akun login</FormLabel>
            <RadioGroup row name="login" aria-labelledby="label-akun" value={login} onChange={(event) => setLogin(event.target.value)}>
              <FormControlLabel value="ya" control={<Radio />} label="Ya, buatkan akun" disabled={isDev} />
              <FormControlLabel value="tidak" control={<Radio />} label="Tidak (hanya dicatat)" />
            </RadioGroup>
            {isDev || fields.login ? <Alert severity="info">PIC Development dicatat sebagai nama saja dan tidak dapat memiliki akun login.</Alert> : null}
          </FormControl>
          {login === 'ya' && !isDev ? (
            <TextField name="username" label="Username" required error={Boolean(fields.username)} helperText={fields.username ?? '4 sampai 30 karakter: huruf kecil, angka, titik, garis bawah, atau strip. Huruf besar otomatis menjadi kecil.'} slotProps={{ htmlInput: { maxLength: 30, autoCapitalize: 'none', spellCheck: false } }} />
          ) : null}
          {state.message && !state.ok && Object.keys(fields).length === 0 ? <Alert severity="error" role="alert">{state.message}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} variant="outlined">Batal</Button>
          <Button type="submit" variant="contained" disabled={pending}>Simpan PIC</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/**
 * Dialog Ubah nama PIC.
 * Masukan: PIC dan callback tutup. Keluaran: elemen dialog.
 * Efek samping: mengirim `picAction` (intent rename).
 * Rujukan: FR-08-01 butir 4.
 */
function RenamePicDialog({ pic, onClose }: { pic: PicView; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(picAction, initialActionState);
  const onSubmit = useRetainedSubmit(formAction);
  useOnSuccess(state, onClose);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="judul-ubah-nama">
      <Box component="form" onSubmit={onSubmit} noValidate>
        <DialogTitle id="judul-ubah-nama">Ubah nama PIC</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <input type="hidden" name="intent" value="rename" />
          <input type="hidden" name="picId" value={pic.id} />
          <TextField name="name" label="Nama" defaultValue={pic.name} autoFocus error={Boolean(state.fields?.name)} helperText={state.fields?.name} slotProps={{ htmlInput: { maxLength: 120 } }} />
          <Typography variant="caption" color="text.secondary">Tahapan dan username tidak dapat diubah.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} variant="outlined">Batal</Button>
          <Button type="submit" variant="contained" disabled={pending}>Simpan</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/**
 * Dialog konfirmasi Reset password; hasilnya password sementara yang tampil sekali.
 * Masukan: PIC, callback tutup, dan callback password sementara. Keluaran: elemen dialog.
 * Efek samping: mengirim `picAction` (intent reset): mengakhiri semua sesi PIC.
 * Rujukan: FR-01-05 butir 4, Screen [008].
 */
function ResetPicDialog({ pic, onClose, onTemporary }: { pic: PicView; onClose: () => void; onTemporary: (shown: TemporaryShown) => void }) {
  const [state, formAction, pending] = useActionState(picAction, initialActionState);
  useOnSuccess(state, (result) => {
    const data = result.data as { picName: string; username: string; temporaryPassword: string } | undefined;
    if (data) onTemporary({ name: data.picName, username: data.username, password: data.temporaryPassword, created: false });
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="judul-reset">
      <Box component="form" action={formAction}>
        <DialogTitle id="judul-reset">Reset password {pic.name}?</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <input type="hidden" name="intent" value="reset" />
          <input type="hidden" name="picId" value={pic.id} />
          <Typography>Sistem membuat password sementara baru. Semua sesi aktif {pic.name} akan diakhiri dan penundaan login dihapus. Password lama tidak dapat dipakai lagi.</Typography>
          {state.message && !state.ok ? <Alert severity="error" role="alert">{state.message}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} variant="outlined">Batal</Button>
          <Button type="submit" variant="contained" color="error" disabled={pending}>Ya, reset password</Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/**
 * Dialog Nonaktifkan/Aktifkan PIC. Bila PIC masih bertugas, menampilkan daftar project terdampak dan meminta
 * konfirmasi ulang; penugasan tidak dilepas otomatis.
 * Masukan: PIC dan callback tutup. Keluaran: elemen dialog.
 * Efek samping: mengirim `picAction` (intent toggle), dengan `confirmed` setelah konfirmasi kedua.
 * Rujukan: FR-08-01 butir 5 sampai 7, EC-08-01.03.
 */
function TogglePicDialog({ pic, onClose }: { pic: PicView; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(picAction, initialActionState);
  useOnSuccess(state, onClose);
  const assignments = Array.isArray(state.data) ? (state.data as Array<{ projectCode: string; projectName: string; stage: string }>) : [];
  const needsConfirm = !state.ok && assignments.length > 0;
  const deactivating = pic.isActive;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="judul-toggle">
      <Box component="form" action={formAction}>
        <DialogTitle id="judul-toggle">{deactivating ? `Nonaktifkan ${pic.name}?` : `Aktifkan ${pic.name}?`}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <input type="hidden" name="intent" value="toggle" />
          <input type="hidden" name="picId" value={pic.id} />
          <input type="hidden" name="active" value={String(!deactivating)} />
          <input type="hidden" name="confirmed" value={String(needsConfirm)} />
          {needsConfirm ? (
            <>
              <Alert severity="warning" role="alert"><b>{pic.name} masih menjadi PIC pada {assignments.length} tahapan yang belum selesai.</b> Penugasan tidak dilepas otomatis; Anda perlu menggantinya sendiri.</Alert>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {assignments.map((item) => <li key={`${item.projectCode}-${item.stage}`}>{item.projectCode} {item.projectName} ({STAGE_LABEL[item.stage as 'BA' | 'DEV' | 'QA'] ?? item.stage})</li>)}
              </ul>
            </>
          ) : (
            <Typography>
              {deactivating
                ? `${pic.username ? 'Akun tidak dapat login dan sesi aktif diakhiri. ' : ''}Data lama tetap tampil. Kartu miliknya tetap tercatat.`
                : `${pic.name} dapat dipilih kembali sebagai PIC${pic.username ? ' dan dapat login lagi' : ''}.`}
            </Typography>
          )}
          {state.message && !state.ok && !needsConfirm ? <Alert severity="error" role="alert">{state.message}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} variant="outlined">Batal</Button>
          <Button type="submit" variant="contained" color={deactivating ? 'error' : 'primary'} disabled={pending}>
            {deactivating ? 'Ya, nonaktifkan' : 'Aktifkan'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/**
 * Dialog password sementara: tampil sekali, tidak tertutup lewat Escape atau klik luar, dan tombol Selesai baru
 * aktif setelah Manager menyatakan sudah mencatatnya.
 * Masukan: password sementara dan callback selesai. Keluaran: elemen dialog.
 * Efek samping: menyalin password ke papan klip bila Manager menekan Salin.
 * Rujukan: FR-01-05 butir 1 dan 2, EC-01-05.01, handoff UX/UI §5.3.
 */
function TemporaryPasswordDialog({ shown, onDone }: { shown: TemporaryShown; onDone: () => void }) {
  const [noted, setNoted] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open fullWidth maxWidth="xs" onClose={() => undefined} aria-labelledby="judul-sementara">
      <DialogTitle id="judul-sementara">{shown.created ? 'PIC ditambahkan' : 'Password direset'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography>Berikan password sementara ini kepada <b>{shown.name}</b> (username <code>{shown.username}</code>).</Typography>
        <Box role="group" aria-label="Password sementara" sx={{ border: 2, borderStyle: 'dashed', borderColor: 'warning.main', borderRadius: 2, p: 2, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
          <Typography variant="caption" color="text.secondary">Password sementara (hanya tampil sekali)</Typography>
          <Typography sx={{ fontFamily: 'monospace', fontSize: 20, wordBreak: 'break-all' }}>{shown.password}</Typography>
          <Button size="small" variant="outlined" onClick={() => { void navigator.clipboard?.writeText(shown.password); setCopied(true); }}>{copied ? 'Tersalin' : 'Salin'}</Button>
        </Box>
        <Alert severity="warning" role="alert">Password ini <b>tidak dapat ditampilkan lagi</b> setelah jendela ditutup. Jika hilang, lakukan Reset password.{shown.created ? '' : ' Semua sesi aktif PIC ini telah diakhiri.'}</Alert>
        <Typography variant="caption" color="text.secondary">{shown.name} wajib membuat password baru saat masuk pertama.</Typography>
        <FormControlLabel control={<Checkbox checked={noted} onChange={(event) => setNoted(event.target.checked)} />} label="Saya sudah mencatat password ini" />
      </DialogContent>
      <DialogActions>
        <Button variant="contained" disabled={!noted} onClick={onDone}>Selesai</Button>
      </DialogActions>
    </Dialog>
  );
}
