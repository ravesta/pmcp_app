/**
 * Uji end-to-end irisan 1 di browser nyata (Edge lewat playwright-core): login, wajib ganti password,
 * header per peran, Master (Aplikasi, Step, PIC), password sementara tampil sekali, hak akses PIC, Jejak Perubahan.
 *
 * Prasyarat: aplikasi berjalan (mis. `next start -p 3130`) pada database dengan akun Manager hasil bootstrap.
 * Masukan lingkungan: `E2E_BASE_URL`, `E2E_MANAGER_TEMP` (password sementara Manager), `E2E_SHOTS` (folder tangkapan layar).
 * Efek samping: membuat data uji (aplikasi "Uji E2E", PIC "Rina E2E") dan mengganti password akun Manager uji.
 * Rujukan: FSD FR-01-01 s.d. FR-01-05, FR-08-01, FR-08-02, FR-19-01, FR-09-01; Technical Design §14 (E2E).
 */
import { launchBrowser } from './_support.mjs';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3130';
const TEMP = process.env.E2E_MANAGER_TEMP;
const SHOTS = process.env.E2E_SHOTS ?? '.';
const NEW_PASSWORD = 'kopi-pagi-tanpa-gula-2026';
const RINA_PASSWORD = 'teh-sore-dengan-sedikit-gula';
const results = [];

/**
 * Mencatat satu langkah uji beserta hasilnya.
 * Masukan: nama langkah dan kondisi lulus. Keluaran: tidak ada.
 * Efek samping: menambah hasil dan mencetak satu baris.
 * Rujukan: laporan uji.
 */
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'LULUS' : 'GAGAL'}  ${name}${pass || !detail ? '' : `  -> ${detail}`}`);
}

/**
 * Mengambil teks halaman saat ini (untuk pemeriksaan isi).
 * Masukan: halaman. Keluaran: teks body.
 * Efek samping: tidak ada.
 * Rujukan: laporan uji.
 */
const bodyText = (page) => page.locator('body').innerText();

/**
 * Login lewat formulir dan menunggu navigasi selesai.
 * Masukan: halaman, username, password. Keluaran: janji selesai.
 * Efek samping: mengirim formulir Login.
 * Rujukan: FR-01-01.
 */
async function signIn(page, username, password) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
}

/**
 * Menemukan tautan sub menu Master (deretan tombol pil) menurut nama persisnya.
 * Masukan: halaman dan nama sub menu. Keluaran: locator tautan.
 * Efek samping: tidak ada.
 * Rujukan: FR-08-06, BL-47.
 */
const masterMenu = (page, name) => page.getByRole('navigation', { name: 'Data master' }).getByRole('link', { name, exact: true });

const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: { width: 1150, height: 820 } });
  const page = await context.newPage();

  // 1. tanpa sesi diarahkan ke login
  await page.goto(`${BASE}/master/pic`);
  check('tanpa sesi, /master/pic diarahkan ke /login', page.url().endsWith('/login'));
  await page.screenshot({ path: `${SHOTS}/e2e_01_login.png` });

  // 2. login salah: pesan generik
  await signIn(page, 'manager', 'password-yang-salah-sekali');
  await page.getByText('Username atau password salah.').waitFor();
  check('login salah menampilkan pesan generik', true);
  await signIn(page, 'tidak.ada.sama.sekali', 'password-yang-salah-sekali');
  await page.getByText('Username atau password salah.').waitFor();
  check('username tidak dikenal menampilkan pesan yang sama', true);

  // 3. login dengan password sementara -> wajib ganti
  await signIn(page, 'manager', TEMP);
  await page.waitForURL('**/ubah-password');
  check('password sementara mengarah ke Ubah Password', true);
  check('mode wajib ganti: tidak ada menu aplikasi', (await page.getByRole('navigation', { name: 'Menu utama' }).count()) === 0);
  await page.goto(`${BASE}/dashboard`);
  check('akun wajib ganti tidak dapat membuka Dashboard (diarahkan balik)', page.url().endsWith('/ubah-password'));
  await page.getByLabel('Password sementara').fill(TEMP);
  await page.getByLabel('Password baru', { exact: true }).fill('password12345');
  await page.getByLabel('Ulangi password baru').fill('password12345');
  await page.getByRole('button', { name: 'Simpan password' }).click();
  await page.getByText(/umum dipakai/).waitFor();
  check('password umum ditolak dengan alasan', true);
  await page.getByLabel('Password baru', { exact: true }).fill('pendek');
  await page.waitForTimeout(100);
  check('daftar aturan menandai gagal saat mengetik', (await page.getByText('✕ Minimal 12 karakter').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/e2e_02_ubah_password.png` });
  await page.getByLabel('Password baru', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Ulangi password baru').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Simpan password' }).click();
  await page.waitForURL('**/dashboard');
  check('ganti password berhasil mengarah ke Dashboard', true);
  check('Dashboard Manager memuat menu Master', (await page.getByRole('tab', { name: 'Master' }).count()) === 1);
  await page.screenshot({ path: `${SHOTS}/e2e_03_dashboard.png` });

  // 4. Master Aplikasi
  await page.getByRole('tab', { name: 'Master' }).click();
  await page.waitForURL('**/master/aplikasi');
  await page.getByText('Precentia Life').waitFor();
  check('Master membuka Aplikasi Terdampak dengan 7 nilai awal', (await page.locator('tbody tr').count()) >= 7);
  await page.getByLabel('Nama aplikasi baru').fill('Uji E2E');
  await page.getByRole('button', { name: 'Tambah' }).click();
  await page.getByRole('cell', { name: 'Uji E2E' }).waitFor();
  check('menambah aplikasi tampil di daftar', true);
  await page.getByLabel('Nama aplikasi baru').fill('uji e2e');
  await page.getByRole('button', { name: 'Tambah' }).click();
  await page.getByText('Nama itu sudah ada.').waitFor();
  check('nama sama (beda huruf besar kecil) ditolak', true);
  await page.screenshot({ path: `${SHOTS}/e2e_04_master_aplikasi.png` });

  // 5. kategori bawaan terkunci, dan sub menu lain
  await masterMenu(page, 'Kategori Alasan Revisi').click();
  await page.waitForURL('**/master/kategori-revisi');
  await page.getByText('Terlambat dari estimasi').waitFor();
  check('kategori bawaan sistem diberi penanda dan tanpa tombol ubah', (await page.getByText('Bawaan sistem').count()) === 2);
  await masterMenu(page, 'Step Tahapan').click();
  await page.waitForURL('**/master/step');
  await page.getByText('Intake & Asesmen Awal').waitFor();
  check('Step Tahapan memuat 9 step BA', (await page.locator('tbody tr').count()) === 9);

  // 6. Master PIC: tambah dengan akun, password sementara tampil sekali
  await masterMenu(page, 'PIC').click();
  await page.waitForURL('**/master/pic');
  await page.getByRole('button', { name: '+ Tambah PIC' }).click();
  await page.getByLabel('Nama').fill('Rina E2E');
  await page.getByRole('combobox', { name: /Tahapan/ }).click();
  await page.getByRole('option', { name: 'Development' }).click();
  await page.getByText('PIC Development dicatat sebagai nama saja').first().waitFor();
  check('memilih Development otomatis meniadakan akun login', (await page.getByLabel('Ya, buatkan akun').isDisabled()));
  await page.getByRole('combobox', { name: /Tahapan/ }).click();
  await page.getByRole('option', { name: 'Business Analyst' }).click();
  await page.getByLabel('Ya, buatkan akun').check();
  await page.getByLabel('Username').fill('Rina.E2E');
  await page.getByRole('button', { name: 'Simpan PIC' }).click();
  await page.getByRole('group', { name: 'Password sementara' }).waitFor();
  const rinaTemp = (await page.getByRole('group', { name: 'Password sementara' }).innerText()).match(/[a-z2-9]{4}(-[a-z2-9]{4}){3}/)?.[0] ?? '';
  check('password sementara tampil dalam format 4x4', rinaTemp.length === 19, rinaTemp);
  check('tombol Selesai nonaktif sebelum dicentang', await page.getByRole('button', { name: 'Selesai' }).isDisabled());
  await page.keyboard.press('Escape');
  check('Escape tidak menutup dialog password sementara', (await page.getByRole('group', { name: 'Password sementara' }).count()) === 1);
  await page.screenshot({ path: `${SHOTS}/e2e_05_password_sementara.png` });
  await page.getByLabel('Saya sudah mencatat password ini').check();
  await page.getByRole('button', { name: 'Selesai' }).click();
  await page.getByRole('cell', { name: 'rina.e2e' }).waitFor();
  check('PIC baru tampil dengan username huruf kecil', true);
  check('password sementara tidak tampil lagi setelah ditutup', !(await bodyText(page)).includes(rinaTemp));
  await page.screenshot({ path: `${SHOTS}/e2e_06_master_pic.png` });

  // 7. jejak perubahan memuat peristiwa tanpa password
  await masterMenu(page, 'Jejak Perubahan').click();
  await page.waitForURL('**/master/jejak');
  await page.getByText(/PIC "Rina E2E"/).first().waitFor();
  const audit = await bodyText(page);
  check('Jejak Perubahan memuat penambahan PIC dan master', /PIC "Rina E2E"/.test(audit) && /Uji E2E/.test(audit));
  check('Jejak Perubahan tidak memuat password', !audit.includes(rinaTemp) && !audit.includes(NEW_PASSWORD));
  await page.screenshot({ path: `${SHOTS}/e2e_07_jejak.png` });

  // 8. keluar, lalu PIC login dengan password sementara
  await page.getByRole('button', { name: /Manager/ }).click();
  await page.getByRole('menuitem', { name: 'Keluar' }).click();
  await page.waitForURL('**/login');
  check('Keluar mengarah ke Login', true);
  await page.goto(`${BASE}/dashboard`);
  check('setelah keluar, Dashboard tidak dapat dibuka', page.url().endsWith('/login'));

  await signIn(page, 'rina.e2e', rinaTemp);
  await page.waitForURL('**/ubah-password');
  await page.getByLabel('Password sementara').fill(rinaTemp);
  await page.getByLabel('Password baru', { exact: true }).fill(RINA_PASSWORD);
  await page.getByLabel('Ulangi password baru').fill(RINA_PASSWORD);
  await page.getByRole('button', { name: 'Simpan password' }).click();
  await page.waitForURL('**/dashboard');
  check('PIC wajib ganti password lalu masuk Dashboard', true);
  check('PIC tidak melihat menu Master', (await page.getByRole('tab', { name: 'Master' }).count()) === 0);
  await page.goto(`${BASE}/master/pic`);
  await page.getByText('Anda tidak memiliki akses ke halaman ini.').waitFor();
  check('PIC membuka /master/pic langsung: akses ditolak dan data master tidak tampil', (await page.getByRole('button', { name: '+ Tambah PIC' }).count()) === 0 && (await page.locator('tbody tr').count()) === 0);
  await page.screenshot({ path: `${SHOTS}/e2e_08_pic_ditolak.png` });
  await page.goto(`${BASE}/master/jejak`);
  await page.getByText('Anda tidak memiliki akses ke halaman ini.').waitFor();
  check('PIC membuka /master/jejak langsung: akses ditolak', true);
} catch (error) {
  check('tidak ada galat tak terduga', false, String(error).split('\n')[0]);
  try {
    const pages = browser.contexts()[0]?.pages() ?? [];
    if (pages[0]) await pages[0].screenshot({ path: `${SHOTS}/e2e_gagal.png` });
  } catch {
    /* abaikan */
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\nRingkasan: ${results.length - failed.length}/${results.length} langkah lulus`);
process.exit(failed.length === 0 ? 0 : 1);
