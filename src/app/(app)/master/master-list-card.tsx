'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useActionState, useState } from 'react';
import { Card, CardHeader } from '@/ui/components/card';
import { ToneChip } from '@/ui/components/tone-chip';
import { useRetainedSubmit } from '@/ui/hooks/use-retained-submit';
import { initialActionState } from '../../_lib/action-state';
import { masterAction } from './actions';

/** Satu item master yang dikirim dari server (hanya data yang dibutuhkan tampilan). */
export interface MasterRow {
  readonly id: number;
  readonly name: string;
  readonly isActive: boolean;
  readonly usedCount: number;
  readonly systemKey: string | null;
}

/** Properti kartu daftar master. */
interface MasterListCardProps {
  readonly kind: string;
  readonly title: string;
  readonly subtitle: string;
  readonly items: ReadonlyArray<MasterRow>;
  readonly maxLength: number;
  /** Satuan kolom "Dipakai", mis. "project", "kartu". */
  readonly usageUnit: string;
  /** Tampilkan tombol urutan (hanya Step Tahapan). */
  readonly orderable?: boolean;
  /** Tahapan (BA/QA) bagi Step Tahapan; dikirim bersama aksi tambah. */
  readonly stage?: 'BA' | 'QA';
  /** Label pada isian nama baru. */
  readonly addLabel: string;
}

/**
 * Kartu pengelolaan satu master pilihan: tambah, ubah nama, nonaktifkan/aktifkan, dan (untuk step) urutan.
 * Masukan: properti kartu. Keluaran: elemen kartu dengan tabel.
 * Efek samping: mengirim Server Action `masterAction`; menyimpan item yang sedang diubah namanya di state komponen.
 * Rujukan: FR-08-02, FR-08-03 butir 3 (kategori bawaan terkunci), FR-19-01, Screen [003] sampai [007].
 */
export function MasterListCard(props: MasterListCardProps) {
  const [state, formAction, pending] = useActionState(masterAction, initialActionState);
  const [editingId, setEditingId] = useState<number | null>(null);
  const onAdd = useRetainedSubmit(formAction);
  const nameError = state.fields?.name;
  return (
    <Card>
      <CardHeader title={props.title} subtitle={props.subtitle} />
      <Box component="form" onSubmit={onAdd} noValidate sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <input type="hidden" name="intent" value="add" />
        <input type="hidden" name="kind" value={props.kind} />
        {props.stage ? <input type="hidden" name="stage" value={props.stage} /> : null}
        <TextField
          key={state.ok ? state.stamp : 'tetap'}
          name="name"
          label={props.addLabel}
          error={Boolean(nameError)}
          helperText={nameError}
          slotProps={{ htmlInput: { maxLength: props.maxLength + 20 } }}
        />
        <Button type="submit" variant="contained" disabled={pending} sx={{ flexShrink: 0 }}>Tambah</Button>
      </Box>
      {state.message && !nameError ? <Alert severity={state.ok ? 'success' : 'error'} role={state.ok ? 'status' : 'alert'}>{state.message}</Alert> : null}
      <TableContainer>
        <Table size="small" sx={{ minWidth: 520 }}>
          <TableHead>
            <TableRow>
              {props.orderable ? <TableCell>No</TableCell> : null}
              <TableCell>Nama</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Dipakai</TableCell>
              <TableCell>Aksi</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {props.items.map((item, index) => (
              <TableRow key={item.id} hover>
                {props.orderable ? <TableCell>{index + 1}</TableCell> : null}
                <TableCell>
                  {editingId === item.id ? (
                    <Box component="form" action={async (formData: FormData) => { formAction(formData); setEditingId(null); }} sx={{ display: 'flex', gap: 1 }}>
                      <input type="hidden" name="intent" value="rename" />
                      <input type="hidden" name="kind" value={props.kind} />
                      <input type="hidden" name="id" value={item.id} />
                      <TextField name="name" defaultValue={item.name} autoFocus slotProps={{ htmlInput: { 'aria-label': 'Nama', maxLength: props.maxLength + 20 } }} />
                      <Button type="submit" variant="contained" size="small">Simpan</Button>
                      <Button type="button" variant="outlined" size="small" onClick={() => setEditingId(null)}>Batal</Button>
                    </Box>
                  ) : (
                    item.name
                  )}
                  {item.systemKey ? <Box component="span" sx={{ ml: 1 }}><ToneChip text="Bawaan sistem" tone="neutral" /></Box> : null}
                </TableCell>
                <TableCell>
                  <ToneChip text={item.isActive ? 'Aktif' : 'Nonaktif'} tone={item.isActive ? 'ok' : 'neutral'} />
                </TableCell>
                <TableCell className="mono">{item.usedCount} {props.usageUnit}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {props.orderable ? (
                      <>
                        <RowForm action={formAction} fields={{ intent: 'move', kind: props.kind, id: item.id, direction: 'up' }} label="Naikkan urutan" short="↑" disabled={index === 0} />
                        <RowForm action={formAction} fields={{ intent: 'move', kind: props.kind, id: item.id, direction: 'down' }} label="Turunkan urutan" short="↓" disabled={index === props.items.length - 1} />
                      </>
                    ) : null}
                    {item.systemKey ? null : (
                      <>
                        <Button size="small" variant="outlined" onClick={() => setEditingId(item.id)}>Ubah nama</Button>
                        <RowForm action={formAction} fields={{ intent: 'toggle', kind: props.kind, id: item.id, active: String(!item.isActive) }} label={item.isActive ? 'Nonaktifkan' : 'Aktifkan'} />
                      </>
                    )}
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary">
        Tidak dihapus, hanya dinonaktifkan. Nama pada data lama tidak ikut berubah.
      </Typography>
    </Card>
  );
}

/** Properti tombol dalam formulir kecil satu baris. */
interface RowFormProps {
  readonly action: (formData: FormData) => void;
  readonly fields: Readonly<Record<string, string | number>>;
  readonly label: string;
  /** Teks pendek pada tombol; bila ada, `label` menjadi `aria-label`. */
  readonly short?: string;
  readonly disabled?: boolean;
}

/**
 * Formulir kecil berisi satu tombol aksi dengan isian tersembunyi.
 * Masukan: aksi formulir, isian tersembunyi, label tombol. Keluaran: elemen formulir.
 * Efek samping: mengirim aksi yang diberikan saat tombol ditekan.
 * Rujukan: FR-08-02 (aksi per baris), NFR-05 (label aksesibel).
 */
function RowForm({ action, fields, label, short, disabled }: RowFormProps) {
  return (
    <Box component="form" action={action} sx={{ display: 'inline' }}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="small" variant="outlined" disabled={disabled} aria-label={short ? label : undefined}>
        {short ?? label}
      </Button>
    </Box>
  );
}
