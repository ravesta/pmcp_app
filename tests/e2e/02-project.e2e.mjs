/**
 * Uji E2E Project: validasi formulir, membuat project (Manager), Gantt dan Daftar, Detail Project,
 * dialog tahapan (status, progres, revisi estimasi, ditahan), penugasan PIC, ubah informasi, dan hak PIC.
 *
 * Prasyarat: dijalankan oleh `scripts/run-e2e.mjs` (akun `manager`, `rina.ba`; PIC Rina, Sari, Dimas, Budi).
 * Efek samping: membuat project PRJ-001 sampai PRJ-003 dan mengubah tahapan BA PRJ-001.
 * Rujukan: FSD FR-02, FR-03, FR-05, FR-06, FR-10, FR-11, FR-12, FR-13, FR-14.
 */
import { BASE, createRunner, day, launchBrowser, login, shot } from './_support.mjs';

const { check, finish } = createRunner('Project');

/** Mengisi dan menyimpan satu project lewat formulir Buat project. */
async function createProject(page, spec) {
  await page.goto(`${BASE}/project/baru`);
  await page.getByLabel('Nama project').fill(spec.name);
  if (spec.ref) await page.getByLabel('No. referensi').fill(spec.ref);
  if (spec.status) await page.getByLabel('Status project').selectOption(spec.status);
  if (spec.reason) await page.getByLabel('Alasan').fill(spec.reason);
  for (const stage of spec.stages ?? []) {
    const section = page.locator(`xpath=//h3[normalize-space()="${stage.title}"]/..`);
    const input = section.getByLabel('PIC (opsional, boleh lebih dari satu)');
    await input.click();
    await input.fill(stage.pic);
    await page.getByRole('option', { name: stage.pic, exact: true }).click();
    await section.getByLabel('Estimasi mulai').fill(stage.start);
    await section.getByLabel('Estimasi selesai').fill(stage.end);
  }
  await page.getByRole('button', { name: 'Simpan project' }).click();
  await page.waitForURL('**/project?*dibuat=*');
}

/** Membuka dialog Perbarui tahapan pada tahapan tertentu. */
async function openStage(page, kind) {
  await page.locator(`#tahap-${kind}`).getByRole('button', { name: /Perbarui tahapan|Lengkapi PIC/ }).click();
  await page.getByRole('dialog').waitFor();
}

/** Menyimpan dialog tahapan lalu menunggu dialog tertutup dan halaman segar. */
async function saveDialog(page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Simpan', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.waitForTimeout(700);
}

const browser = await launchBrowser();
try {
  const mgr = await login(browser, 'manager');
  await mgr.getByRole('tab', { name: 'Project' }).click();
  await mgr.waitForURL('**/project');
  check('daftar kosong menampilkan "Belum ada project."', (await mgr.getByText('Belum ada project.').count()) > 0);

  await mgr.goto(`${BASE}/project/baru`);
  check('judul formulir "Project baru"', (await mgr.getByRole('heading', { level: 1, name: 'Project baru' }).count()) === 1);
  check('tiga kotak tahapan bernama lengkap', (await mgr.locator('h3', { hasText: /^(Business Analyst|Development|Quality Assurance)$/ }).count()) === 3);
  await mgr.getByLabel('Status project').selectOption('DEFERRED');
  await mgr.getByRole('button', { name: 'Simpan project' }).click();
  await mgr.getByText('Nama project wajib diisi.').first().waitFor();
  check('nama kosong ditolak', true);
  check('status Ditunda tanpa alasan ditolak', (await mgr.getByText('Isi alasan untuk status Ditunda.').count()) > 0);

  await createProject(mgr, {
    name: 'Portal Klaim Online', ref: 'JIRA-101', status: 'RUNNING',
    stages: [
      { title: 'Business Analyst', pic: 'Rina', start: day(0), end: day(4) },
      { title: 'Development', pic: 'Budi', start: day(7), end: day(25) },
      { title: 'Quality Assurance', pic: 'Dimas', start: day(28), end: day(32) },
    ],
  });
  check('banner sukses untuk project pertama', (await mgr.getByText(/berhasil dibuat/).count()) > 0);
  await createProject(mgr, { name: 'Migrasi Data Polis', status: 'RUNNING', stages: [{ title: 'Business Analyst', pic: 'Sari', start: day(-7), end: day(4) }] });
  await createProject(mgr, { name: 'Proyek Ditunda', status: 'DEFERRED', reason: 'Menunggu anggaran' });

  await mgr.goto(`${BASE}/project`);
  check('Gantt memuat tiga project', (await mgr.locator('section[aria-label^="PRJ-"]').count()) === 3);
  await mgr.goto(`${BASE}/project?v=daftar`);
  check('Daftar memuat tiga baris', (await mgr.locator('tbody tr').count()) === 3);

  // filter seperti mockup: langsung berlaku tanpa tombol Terapkan
  check('filter Project tanpa tombol Terapkan', (await mgr.getByRole('button', { name: 'Terapkan' }).count()) === 0);
  await mgr.getByRole('searchbox', { name: 'Cari' }).fill('Migrasi');
  await mgr.waitForURL('**q=Migrasi**');
  await mgr.getByText('Menampilkan 1-1 dari 1').waitFor();
  check('pencarian menyaring daftar sambil mengetik', (await mgr.locator('tbody tr').count()) === 1);
  await mgr.getByRole('searchbox', { name: 'Cari' }).fill('');
  await mgr.getByText('Menampilkan 1-3 dari 3').waitFor();
  await mgr.getByRole('button', { name: /Filter lanjutan/ }).click();
  await mgr.locator('#filter-pic').selectOption({ label: 'Sari (BA)' });
  await mgr.waitForURL('**pic=**');
  await mgr.getByText('Menampilkan 1-1 dari 1').waitFor();
  check('filter lanjutan PIC langsung berlaku', (await mgr.locator('tbody tr').count()) === 1);
  await mgr.goto(`${BASE}/project?v=daftar`);

  // ---- Detail project sebagai Rina (PIC BA) ----
  const rina = await login(browser, 'rina.ba');
  await rina.goto(`${BASE}/project?v=daftar&milik=1`);
  check('filter "milik saya": Rina hanya melihat project BA miliknya', (await rina.locator('tbody tr').count()) === 1);
  await rina.goto(`${BASE}/project/PRJ-001`);
  check('Rina dapat memperbarui tahapan BA miliknya', (await rina.locator('#tahap-BA').getByRole('button', { name: /Perbarui tahapan/ }).count()) === 1);
  check('Rina tidak punya tombol di tahapan Development', (await rina.locator('#tahap-DEV button').count()) === 0);
  check('PIC tahapan boleh Ubah informasi (FR-03: PIC yang memiliki tahapan)', (await rina.getByRole('button', { name: 'Ubah informasi' }).count()) === 1);

  await openStage(rina, 'BA');
  await rina.getByRole('dialog').getByLabel('Status', { exact: true }).selectOption('RUNNING');
  await saveDialog(rina);
  const baText = await rina.locator('#tahap-BA').innerText();
  check('tahapan BA berjalan: tanggal mulai aktual tercatat', /Aktual: mulai/.test(baText), baText.replace(/\n/g, ' | ').slice(0, 200));

  await openStage(rina, 'BA');
  await rina.getByLabel(/Sesuaikan manual/).fill('30');
  await saveDialog(rina);
  check('progres manual 30% tersimpan', /30%/.test(await rina.locator('#tahap-BA').innerText()));

  await openStage(rina, 'BA');
  await rina.getByLabel(/Sesuaikan manual/).fill('100');
  await rina.getByRole('dialog').getByRole('button', { name: 'Simpan', exact: true }).click();
  await rina.getByText(/0 sampai 99/).first().waitFor();
  check('progres 100% ditolak (hanya 0 sampai 99)', true);
  await rina.getByRole('button', { name: /Tutup|Batal/ }).first().click();
  await rina.getByRole('dialog').waitFor({ state: 'detached' });

  await openStage(rina, 'BA');
  await rina.getByLabel('Estimasi selesai baru').fill(day(11));
  await rina.getByLabel('Catatan alasan').fill('Scope bertambah');
  await rina.getByLabel('Kategori alasan').selectOption({ label: 'Perubahan scope' });
  await rina.getByLabel('Estimasi mulai baru').fill(day(0));
  await saveDialog(rina);
  check('revisi estimasi tercatat sebagai Revisi 1', (await rina.locator('#tahap-BA').innerText()).includes('Revisi 1'));

  await openStage(rina, 'BA');
  await rina.getByRole('dialog').getByLabel('Status', { exact: true }).selectOption('HELD');
  await rina.getByRole('dialog').getByRole('button', { name: 'Simpan', exact: true }).click();
  await rina.getByText('Isi alasan ditahan.').first().waitFor();
  check('status Ditahan tanpa alasan ditolak', true);
  await rina.getByLabel('Alasan ditahan').fill('Menunggu data bisnis');
  await saveDialog(rina);
  check('tahapan BA berstatus Ditahan', (await rina.locator('#tahap-BA').innerText()).includes('Ditahan'));
  check('Rina tanpa galat konsol', rina.errors.filter((e) => !e.includes('hydrated') && !e.includes('status of 404')).length === 0, JSON.stringify(rina.errors));

  // ---- Manager: penugasan, ubah informasi, tidak ditemukan ----
  await mgr.goto(`${BASE}/project/PRJ-002`);
  await openStage(mgr, 'DEV');
  const picInput = mgr.getByRole('dialog').getByLabel('PIC', { exact: true });
  await picInput.click();
  await picInput.fill('Budi');
  await mgr.getByRole('option', { name: 'Budi', exact: true }).click();
  await mgr.getByRole('dialog').getByLabel(/Estimasi mulai \(/).fill(day(7));
  await mgr.getByRole('dialog').getByLabel(/Estimasi selesai \(/).fill(day(25));
  await saveDialog(mgr);
  check('Manager menugaskan PIC dan estimasi pada tahapan Development', (await mgr.locator('#tahap-DEV').innerText()).includes('Budi'));

  await mgr.getByRole('button', { name: 'Ubah informasi' }).click();
  await mgr.getByRole('dialog').getByLabel('Nama project').fill('Migrasi Data Polis v2');
  await mgr.getByRole('button', { name: 'Simpan perubahan' }).click();
  await mgr.getByRole('dialog').waitFor({ state: 'detached' });
  await mgr.waitForTimeout(600);
  check('judul project berubah setelah Ubah informasi', (await mgr.locator('h1').innerText()).includes('Migrasi Data Polis v2'));
  await mgr.getByRole('button', { name: 'Ubah informasi' }).click();
  await mgr.getByRole('button', { name: 'Simpan perubahan' }).click();
  await mgr.getByText('Tidak ada perubahan untuk disimpan.').first().waitFor();
  check('menyimpan tanpa perubahan menampilkan pesan', true);
  await mgr.getByRole('button', { name: 'Batal' }).click();

  await mgr.goto(`${BASE}/project/PRJ-999`);
  check('kode project tidak ada: "Project tidak ditemukan."', (await mgr.getByText('Project tidak ditemukan.').count()) > 0);
  check('Manager tanpa galat konsol', mgr.errors.filter((e) => !e.includes('hydrated') && !e.includes('status of 404')).length === 0, JSON.stringify(mgr.errors));
} catch (error) {
  check('tidak ada galat tak terduga', false, String(error).split('\n').slice(0, 3).join(' '));
  for (const context of browser.contexts()) for (const page of context.pages()) await shot(page, 'project-gagal');
}
await finish(browser);
