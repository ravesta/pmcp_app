/**
 * Pembantu bersama uji E2E: peluncur browser, pencatat hasil, login, dan tanggal relatif.
 *
 * Masukan lingkungan: `E2E_BASE_URL`, `E2E_CHROMIUM_PATH` (opsional; bila kosong memakai Chromium bawaan Playwright),
 * `E2E_SHOTS` (folder tangkapan layar saat gagal). Efek samping: membuka browser dan menulis tangkapan layar kegagalan.
 * Rujukan: Technical Design §14 (E2E).
 */
import { chromium } from 'playwright-core';

export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3130';
export const PASSWORD = process.env.E2E_PASSWORD ?? 'rahasia-uji-panjang-123';
const SHOTS = process.env.E2E_SHOTS ?? '.';

/**
 * Meluncurkan browser tanpa kepala.
 * Masukan: tidak ada. Keluaran: janji browser.
 * Efek samping: memulai proses Chromium.
 * Rujukan: Technical Design §14.
 */
export function launchBrowser() {
  const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;
  return chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
}

/**
 * Membuat pencatat hasil untuk satu berkas skenario.
 * Masukan: nama skenario. Keluaran: `check(nama, lulus, rincian)` dan `finish(browser)` yang menutup browser dan mengakhiri proses.
 * Efek samping: mencetak satu baris per langkah; `finish` memanggil `process.exit` (0 bila semua lulus).
 * Rujukan: laporan uji.
 */
export function createRunner(scenario) {
  const results = [];
  console.log(`\n== ${scenario} ==`);
  return {
    check(name, pass, detail = '') {
      results.push({ name, pass: Boolean(pass) });
      console.log(`${pass ? 'LULUS' : 'GAGAL'}  ${name}${pass || !detail ? '' : `  -> ${detail}`}`);
    },
    async finish(browser) {
      await browser.close();
      const failed = results.filter((r) => !r.pass);
      console.log(`Ringkasan ${scenario}: ${results.length - failed.length}/${results.length} langkah lulus`);
      process.exit(failed.length === 0 ? 0 : 1);
    },
  };
}

/**
 * Membuka sesi login baru (konteks terpisah) dengan pemantau galat browser.
 * Masukan: browser, username, opsi lebar layar. Keluaran: halaman dengan `page.errors` (galat konsol dan halaman).
 * Efek samping: mengirim formulir Login.
 * Rujukan: FR-01-01.
 */
export async function login(browser, username, { width = 1280, height = 900, password = PASSWORD } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') page.errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Username').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.waitForURL('**/dashboard');
  return page;
}

/**
 * Mengambil tangkapan layar kegagalan agar mudah dilihat.
 * Masukan: halaman dan nama berkas. Keluaran: janji selesai.
 * Efek samping: menulis satu berkas PNG; galat penulisan diabaikan.
 * Rujukan: laporan uji.
 */
export async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
}

/**
 * Menghasilkan tanggal berformat dd/mm/yyyy relatif terhadap Senin minggu lalu, supaya skenario tidak bergantung tanggal tetap.
 * Masukan: selisih hari dari Senin minggu lalu. Keluaran: teks tanggal.
 * Efek samping: membaca jam sistem (hanya di uji).
 * Rujukan: FR-02 (format tanggal), laporan uji.
 */
export function day(offset) {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
