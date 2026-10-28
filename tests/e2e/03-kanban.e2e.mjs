/**
 * Uji E2E Kanban: kartu project dengan pratinjau revisi otomatis, progres, log activity (termasuk bentrok jam),
 * jadwal ulang, pindah kolom, kartu activity, Detail Project, dan hak Manager (hanya baca).
 *
 * Prasyarat: dijalankan sesudah `02-project.e2e.mjs` (PRJ-001 dengan tahapan BA milik Rina).
 * Efek samping: membuat dua kartu milik Rina dan satu log.
 * Rujukan: FSD FR-16 sampai FR-18, FR-20, FR-21, FR-13-05.
 */
import { BASE, createRunner, day, launchBrowser, login, shot } from './_support.mjs';

const { check, finish } = createRunner('Kanban');
const browser = await launchBrowser();
try {
  const rina = await login(browser, 'rina.ba');
  await rina.goto(`${BASE}/kanban`);
  check('papan awal kosong (3 kolom)', (await rina.getByText('Belum ada kartu').count()) === 3);

  await rina.getByRole('link', { name: '+ Buat kartu' }).click();
  const dialog = rina.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByLabel('Project').selectOption({ index: 1 });
  await dialog.getByLabel('Judul rencana').fill('Analisis alur klaim');
  await dialog.getByLabel('Rencana mulai').fill(day(9));
  await dialog.getByLabel('Rencana selesai').fill(day(18));
  await dialog.getByText(/akan otomatis direvisi/).waitFor();
  check('pratinjau revisi otomatis tampil saat rencana melewati estimasi', true);
  await dialog.getByRole('button', { name: 'Simpan kartu' }).click();
  await dialog.getByText(/Isi catatan alasan/).first().waitFor();
  check('revisi mewajibkan kategori dan catatan alasan', true);
  await dialog.getByLabel('Kategori alasan').selectOption({ label: 'Perubahan scope' });
  await dialog.getByLabel('Catatan alasan').fill('Scope bertambah');
  await dialog.getByLabel('Kolom awal').selectOption('IN_PROGRESS');
  await dialog.getByRole('button', { name: 'Simpan kartu' }).click();
  await rina.getByText(/berhasil dibuat/).waitFor();
  check('kartu muncul di kolom In Progress', (await rina.locator('section[aria-label="Kolom In Progress"]').getByText('Analisis alur klaim').count()) === 1);

  await rina.getByRole('link', { name: 'Analisis alur klaim' }).click();
  await rina.getByRole('dialog').waitFor();
  await rina.getByRole('button', { name: '50%' }).click();
  await rina.waitForTimeout(1200);
  check('progres 50% tersimpan', (await rina.getByRole('button', { name: '50%' }).getAttribute('aria-pressed')) === 'true');
  await rina.getByLabel('Step tahapan').selectOption({ index: 1 });
  await rina.getByLabel('Uraian aktivitas').fill('Wawancara pemilik proses');
  await rina.getByRole('button', { name: 'Simpan log' }).click();
  await rina.getByText('Log tersimpan.').waitFor();
  check('log activity tersimpan dan tampil di tabel', (await rina.getByRole('table', { name: 'Log activity kartu' }).count()) === 1);
  await rina.getByRole('button', { name: 'Simpan log' }).click();
  await rina.getByText(/bentrok/).first().waitFor();
  check('log dengan jam bentrok ditolak', true);

  await rina.getByRole('button', { name: 'Jadwal ulang rencana' }).click();
  await rina.getByLabel('Alasan', { exact: true }).selectOption({ index: 1 });
  await rina.getByLabel('Rencana selesai baru').fill(day(17));
  await rina.getByRole('button', { name: 'Simpan jadwal ulang' }).click();
  await rina.getByText(/Rencana dijadwal ulang/).waitFor();
  check('jadwal ulang rencana tersimpan', true);
  await rina.keyboard.press('Escape');
  await rina.waitForTimeout(500);

  await rina.getByRole('button', { name: 'Pindah ke Selesai' }).click();
  await rina.waitForTimeout(1500);
  check('tombol panah memindahkan kartu ke Done', (await rina.locator('section[aria-label="Kolom Done"]').getByText('Analisis alur klaim').count()) === 1);

  await rina.getByRole('link', { name: '+ Kartu activity' }).click();
  const activity = rina.getByRole('dialog');
  await activity.getByLabel('Kategori activity').selectOption({ label: 'Rapat departemen' });
  await activity.getByLabel('Judul rencana').fill('Rapat mingguan');
  await activity.getByLabel('Rencana mulai').fill(day(9));
  await activity.getByLabel('Rencana selesai').fill(day(9));
  await activity.getByRole('button', { name: 'Simpan kartu' }).click();
  await rina.getByText(/berhasil dibuat/).waitFor();
  check('kartu activity dibuat', true);

  await rina.goto(`${BASE}/project/PRJ-001`);
  check('Detail Project memuat Rencana kerja', (await rina.getByRole('table', { name: 'Rencana kerja project' }).locator('tbody tr').count()) >= 1);
  check('Detail Project memuat Log activity', (await rina.getByRole('table', { name: 'Log activity project' }).locator('tbody tr').count()) >= 1);
  check('Rina tanpa galat konsol', rina.errors.filter((e) => !e.includes('hydrated') && !e.includes('status of 404')).length === 0, JSON.stringify(rina.errors));

  // filter seperti mockup: langsung berlaku, tanpa tombol Terapkan; Dari/Sampai hanya pada rentang tanggal
  await rina.goto(`${BASE}/kanban`);
  check('filter Kanban tanpa tombol Terapkan dan Reset', (await rina.getByRole('button', { name: /Terapkan|Reset/ }).count()) === 0);
  check('Dari/Sampai tersembunyi pada periode Minggu ini', (await rina.getByLabel(/^Dari/).count()) === 0);
  await rina.getByLabel('Jenis').selectOption('activity');
  await rina.waitForURL('**jenis=activity**');
  check('memilih Jenis langsung memfilter papan', (await rina.locator('section[aria-label="Kolom Planned"]').getByText('Rapat mingguan').count()) === 1
    && (await rina.getByText('Analisis alur klaim').count()) === 0);
  await rina.getByLabel('Cari').fill('rapat');
  await rina.waitForURL('**q=rapat**');
  check('pencarian berlaku sambil mengetik', true);
  await rina.getByLabel('Periode').selectOption('rentang');
  await rina.getByLabel(/^Dari/).waitFor();
  check('periode Rentang tanggal memunculkan Dari dan Sampai', (await rina.getByLabel(/^Sampai/).count()) === 1);
  await rina.getByLabel('Periode').selectOption('minggu');
  check('PIC Development tidak ada di daftar PIC', (await rina.getByLabel('PIC', { exact: true }).locator('option', { hasText: '(DEV)' }).count()) === 0);

  const mgr = await login(browser, 'manager');
  await mgr.goto(`${BASE}/kanban`);
  check('Manager melihat kartu Rina', (await mgr.getByText('Analisis alur klaim').count()) > 0);
  check('Manager tidak punya tombol buat kartu', (await mgr.getByRole('link', { name: '+ Buat kartu' }).count()) === 0);
  check('Manager tidak punya tombol pindah kolom', (await mgr.getByRole('button', { name: /^Pindah ke/ }).count()) === 0);
  check('Manager tanpa galat konsol', mgr.errors.filter((e) => !e.includes('hydrated') && !e.includes('status of 404')).length === 0, JSON.stringify(mgr.errors));
} catch (error) {
  check('tidak ada galat tak terduga', false, String(error).split('\n').slice(0, 3).join(' '));
  for (const context of browser.contexts()) for (const page of context.pages()) await shot(page, 'kanban-gagal');
}
await finish(browser);
