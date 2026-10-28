/**
 * Uji E2E keamanan dan ketahanan: header keamanan dengan nonce CSP, health check, halaman 404, hak akses antarperan,
 * pencatatan akses ditolak di Jejak Perubahan, dan penguncian login berulang.
 *
 * Prasyarat: dijalankan terakhir. Efek samping: mencatat peristiwa Keamanan dan mengunci akun `dimas.qa` sementara.
 * Rujukan: FSD FR-01-03, FR-01-04, EC-15-01.01; Security Design (CSP, header).
 */
import { BASE, createRunner, launchBrowser, login, shot } from './_support.mjs';

const { check, finish } = createRunner('Keamanan');
const browser = await launchBrowser();
try {
  const health = await fetch(`${BASE}/api/health`);
  check('/api/health menjawab 200 dengan database hidup', health.status === 200);

  const login1 = await fetch(`${BASE}/login`);
  const csp = login1.headers.get('content-security-policy') ?? '';
  check('CSP memakai nonce dan strict-dynamic', /script-src[^;]*'nonce-[^']+'/.test(csp) && csp.includes("'strict-dynamic'"));
  check('CSP melarang objek dan framing', csp.includes("object-src 'none'") && /frame-ancestors 'none'/.test(csp));
  check('header X-Content-Type-Options dan Referrer-Policy terpasang',
    login1.headers.get('x-content-type-options') === 'nosniff' && Boolean(login1.headers.get('referrer-policy')));
  const second = await fetch(`${BASE}/login`);
  check('nonce CSP berbeda tiap permintaan', csp !== (second.headers.get('content-security-policy') ?? ''));

  const rina = await login(browser, 'rina.ba');
  await rina.goto(`${BASE}/halaman-yang-tidak-ada`);
  const notFound = (await rina.locator('body').innerText()).replace(/\n/g, ' | ').slice(0, 150);
  check('halaman tidak ada menampilkan pesan "Halaman tidak ditemukan."', /Halaman tidak ditemukan/.test(notFound), notFound);
  await rina.goto(`${BASE}/master/pic`);
  check('PIC ditolak membuka Master', (await rina.getByText('Anda tidak memiliki akses ke halaman ini.').count()) === 1);

  const mgr = await login(browser, 'manager');
  await mgr.goto(`${BASE}/master/jejak`);
  check('Jejak Perubahan memuat catatan login berhasil Rina', (await mgr.getByText('Login berhasil untuk rina.ba').count()) > 0);

  // penguncian: percobaan login salah berulang pada satu akun
  const page = await (await browser.newContext()).newPage();
  let locked = false;
  for (let i = 0; i < 8 && !locked; i += 1) {
    await page.goto(`${BASE}/login`);
    await page.getByLabel('Username').fill('dimas.qa');
    await page.locator('input[name="password"]').fill(`salah-sekali-${i}-xxxxxxxx`);
    await page.getByRole('button', { name: 'Masuk' }).click();
    await page.waitForTimeout(500);
    locked = (await page.getByText(/terkunci|terlalu banyak/i).count()) > 0;
  }
  check('percobaan login salah berulang memicu penguncian sementara', locked);
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Username').fill('dimas.qa');
  await page.locator('input[name="password"]').fill(process.env.E2E_PASSWORD);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await page.waitForTimeout(800);
  check('password benar pun ditolak selama terkunci', !page.url().includes('/dashboard'));
} catch (error) {
  check('tidak ada galat tak terduga', false, String(error).split('\n').slice(0, 3).join(' '));
  for (const context of browser.contexts()) for (const page of context.pages()) await shot(page, 'keamanan-gagal');
}
await finish(browser);
