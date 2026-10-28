'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { Card } from '@/ui/components/card';
import { useActionState } from 'react';
import { useRetainedSubmit } from '@/ui/hooks/use-retained-submit';
import { initialActionState } from '../../_lib/action-state';
import { thresholdAction } from './actions';

/** Properti formulir ambang peringatan. */
interface ThresholdFormProps {
  /** Kunci pengaturan: revision_warn_threshold atau reschedule_warn_threshold. */
  readonly settingKey: 'revision_warn_threshold' | 'reschedule_warn_threshold';
  readonly label: string;
  readonly value: number;
}

/**
 * Formulir pengaturan batas peringatan (bilangan bulat 1 sampai 20).
 * Masukan: kunci pengaturan, label, nilai saat ini. Keluaran: elemen formulir.
 * Efek samping: mengirim Server Action `thresholdAction`.
 * Rujukan: FR-08-03 butir 4, FR-08-05 butir 3, EC-08-03.01.
 */
export function ThresholdForm({ settingKey, label, value }: ThresholdFormProps) {
  const [state, formAction, pending] = useActionState(thresholdAction, initialActionState);
  const error = state.fields?.value;
  const onSubmit = useRetainedSubmit(formAction);
  return (
    <Card>
      <Box component="form" onSubmit={onSubmit} noValidate sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <input type="hidden" name="key" value={settingKey} />
        <TextField name="value" type="number" label={label} defaultValue={value} error={Boolean(error)} helperText={error} sx={{ maxWidth: 320 }} slotProps={{ htmlInput: { min: 1, max: 20 } }} />
        <Button type="submit" variant="outlined" disabled={pending}>Simpan batas</Button>
      </Box>
      {state.ok ? <Alert severity="success" role="status" sx={{ mt: 1 }}>{state.message}</Alert> : null}
    </Card>
  );
}
