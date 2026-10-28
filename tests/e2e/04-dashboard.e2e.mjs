/**
 * Uji E2E Dashboard dan Riwayat: kartu KPI Head dan PIC, pergantian periode kapasitas, tautan kartu ke daftar tersaring,
 * Riwayat tahapan selesai dan aktivitas harian, serta tampilan lebar telepon tanpa gulir mendatar.
 *
 * Prasyarat: dijalankan sesudah `03-kanban.e2e.mjs`. Efek samping: tidak mengubah data.
 * Rujukan: FSD FR-04, FR-07; NFR responsif.
 */
import { BASE, createRunner, launchBrowser, login, shot } from './_support.mjs';

const { check, finish } = createRunner('Dashboard dan Riwayat');
const browser = await launchBrowser();
const noise = (errors) => errors.filter((e) => !e.includes('hydrated') && !e.includes('status of 404'));
try {
  const mgr = await login(browser, 'manager');
  check('Dashboard Head memuat tabel risiko', (await mgr.getByRole('table', { name: 'Project terlambat atau berisiko' }).count()) === 1);
  await mgr.getByRole('link', { name: 'Bulan' }).first().click();
  await mgr.waitForURL('**kap=bulan');
  check('kapasitas dapat diganti ke mode Bulan', true);
  await mgr.goto(`${BASE}/dashboard`);
  await mgr.getByRole('link', { name: /Tahapan terlambat/ }).click();
  await mgr.waitForURL('**/project?sts=LATE');
  check('kartu "Tahapan terlambat" membuka daftar tersaring', true);
  await mgr.goto(`${BASE}/riwayat?tab=harian`);
  check('Riwayat harian dapat dibuka Manager', (await mgr.getByRole('heading', { level: 1 }).count()) >= 1);
  check('Manager tanpa galat konsol', noise(mgr.errors).length === 0, JSON.stringify(mgr.errors));

  const rina = await login(browser, 'rina.ba');
  check('Dashboard PIC memuat antrean pekerjaan', (await rina.getByRole('table', { name: 'Antrean pekerjaan' }).count()) === 1);
  await rina.goto(`${BASE}/riwayat?tab=harian&mode=minggu`);
  check('Riwayat harian mode minggu menampilkan hari kerja (Senin sampai Jumat)', (await rina.locator('section[aria-label^="Log "]').count()) === 5);
  await rina.goto(`${BASE}/riwayat`);
  check('Riwayat tahapan selesai dapat dibuka', (await rina.getByRole('heading', { level: 1 }).count()) >= 1);
  check('Rina tanpa galat konsol', noise(rina.errors).length === 0, JSON.stringify(rina.errors));

  const phone = await login(browser, 'rina.ba', { width: 375, height: 800 });
  for (const path of ['/dashboard', '/kanban', '/project', '/riwayat']) {
    await phone.goto(`${BASE}${path}`);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`lebar telepon 375px: ${path} tanpa gulir mendatar`, !overflow);
  }
} catch (error) {
  check('tidak ada galat tak terduga', false, String(error).split('\n').slice(0, 3).join(' '));
  for (const context of browser.contexts()) for (const page of context.pages()) await shot(page, 'dashboard-gagal');
}
await finish(browser);
