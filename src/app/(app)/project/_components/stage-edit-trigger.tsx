'use client';

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ProjectFormOptions, StageView } from '@/modules/project';
import { StageDialog } from './stage-dialog';

/** Data yang dibutuhkan dialog Perbarui Tahapan dari halaman yang menampilkan Gantt. */
export interface StageEditContext {
  readonly options: ProjectFormOptions;
  readonly revisionThreshold: number;
  readonly isManager: boolean;
}

/** Properti pemicu dialog tahapan. */
interface StageEditTriggerProps {
  readonly projectCode: string;
  readonly projectName: string;
  readonly stage: StageView;
  readonly context: StageEditContext;
  /** `bar` = bar Gantt (tombol berisi teks bar); `link` = tombol bergaya tautan (mis. "Atur"); `button` = tombol kecil bertepi (mis. "Perbarui" pada antrean). */
  readonly variant: 'bar' | 'link' | 'button';
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly title?: string;
  readonly ariaLabel?: string;
  /** Isi tombol (dirender server: progres dan teks bar). */
  readonly children: ReactNode;
  /** True bila dialog dibuka dari halaman selain Detail Project (menampilkan "Lihat detail project"). */
  readonly showDetailLink: boolean;
}

/**
 * Tombol pada Gantt yang membuka dialog Perbarui Tahapan di halaman yang sama, seperti mockup v0.2 (klik bar atau
 * "Atur" membuka dialog; tidak berpindah halaman). Tombol hanya kenyamanan; hak sebenarnya dicek ulang di server saat Simpan.
 * Masukan: kode dan nama project, tahapan, data dialog, tampilan tombol, isi, dan penanda tautan detail. Keluaran: tombol dan dialog.
 * Efek samping: menyimpan buka/tutup dialog di state; dialog mengirim `updateStageAction` saat Simpan.
 * Rujukan: FR-12-01 butir 7, Screen [016], FR-01-04, mockup v0.2 (atribut data-edit pada bar Gantt).
 */
export function StageEditTrigger({ projectCode, projectName, stage, context, variant, className, style, title, ariaLabel, children, showDetailLink }: StageEditTriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        style={variant === 'button' ? { background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 6, padding: '3px 10px', font: 'inherit', fontSize: 13, color: 'var(--accent)', cursor: 'pointer', ...style } : variant === 'link' ? { background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer', ...style } : { cursor: 'pointer', fontFamily: 'inherit', ...style }}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open ? <StageDialog projectCode={projectCode} projectName={projectName} stage={stage} options={context.options} revisionThreshold={context.revisionThreshold} isManager={context.isManager} showDetailLink={showDetailLink} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
